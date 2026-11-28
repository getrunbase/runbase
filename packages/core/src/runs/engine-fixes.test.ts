// Run engine: failure returned by a function (A3), propagation of the test
// flag (A4), condition / switch in value mode (A5), concurrency key (A8),
// {{event.recordId}} (A10). Integration: DATABASE_URL, REDIS_URL and deno.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Worker } from "bullmq";
import { busQueue, queueOptions } from "../bus";
import { evaluateValue } from "../filter";
import { errorsService } from "../errors";
import { eventsService } from "../events";
import { functionsService } from "../functions";
import { objectsService } from "../objects";
import { overviewService } from "../overview";
import { recordsService } from "../records";
import type { TenantContext } from "../tenant";
import { resolve, withRecordId } from "../triggers";
import { workflowsService } from "../workflows";
import { processStep, runsQueue, runsService, RUNS_QUEUE } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function owner(name: string): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, ${name}, ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

async function settle(ctx: TenantContext, runId: string, tries = 150) {
  let run;
  for (let i = 0; i < tries; i++) {
    run = await runsService.get(ctx, runId);
    if (!["running", "waiting"].includes(run!.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return run!;
}

const out = (run: Awaited<ReturnType<typeof settle>>, id: string) =>
  run.steps.find((s) => s.stepId === id)?.output as Record<string, unknown>;

test("evaluateValue: type inferred from the value", () => {
  assert.equal(evaluateValue("eq", "hot", "hot"), true);
  assert.equal(evaluateValue("gt", 5, 3), true);
  assert.equal(evaluateValue("gt", "5", 30), false);
  assert.equal(evaluateValue("in", "b", ["a", "b"]), true);
  assert.equal(evaluateValue("contains", ["x", "y"], "y"), true);
  assert.equal(evaluateValue("is_empty", null), true);
  assert.equal(evaluateValue("eq", true, true), true);
  assert.equal(
    evaluateValue("before", "2020-01-01T00:00:00Z", "2021-01-01"),
    true,
  );
  assert.deepEqual(withRecordId({ a: 1 }, "r1"), { a: 1, recordId: "r1" });
  assert.deepEqual(withRecordId({ recordId: "x" }, "r1"), { recordId: "x" });
  assert.equal(withRecordId("s", "r1"), "s");
});

test("A3 A4 A5 A8 A10: run engine", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  await busQueue().obliterate({ force: true });
  const ctx = await owner("Engine");
  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
    concurrency: 4,
  });
  try {
    const obj = await objectsService.create(ctx, {
      slug: "lead",
      name: "Lead",
      fields: [{ key: "name", label: "Name", type: "text" }],
    });

    // A3: { ok: false, error } makes the step fail, after its retries.
    await functionsService.save(ctx, {
      name: "fails",
      code: `export default () => ({ ok: false, error: "quota reached" })`,
    });
    const failing = await workflowsService.create(ctx, {
      name: "fails",
      definition: {
        trigger: { type: "trigger.manual" },
        steps: [
          {
            id: "f",
            type: "fn.fails",
            input: {},
            retry: { attempts: 2, backoff: "1s" },
          },
        ],
      },
    });
    const r3 = await settle(
      ctx,
      (await runsService.start(ctx, failing.id))!.id,
    );
    assert.equal(r3.status, "failed");
    assert.match(r3.error!, /quota reached/);
    assert.equal(r3.steps[0]!.attempts, 2);
    const errs = await errorsService.list(ctx, { workflowId: failing.id });
    assert.ok(
      JSON.stringify(errs).includes("quota reached"),
      "entry in the error center",
    );

    // A4: test run -> {{run.test}}, ctx.test, writes and test sub-run.
    await functionsService.save(ctx, {
      name: "writer",
      code: `export default async (i, { records, events, test }) => {
        const { record } = await records.upsert({ objectId: "lead", data: { name: "from-fn" } });
        await events.push({ type: "fn.wrote", recordId: record.id });
        return { test };
      }`,
      permissions: {
        domains: [],
        secrets: [],
        records: "write",
        events: "write",
      },
    });
    await workflowsService.create(ctx, {
      name: "child",
      definition: {
        trigger: { type: "trigger.manual" },
        steps: [
          {
            id: "c",
            type: "data.set",
            input: { values: { t: "{{run.test}}" } },
          },
        ],
      },
    });
    const parent = await workflowsService.create(ctx, {
      name: "parent",
      definition: {
        trigger: { type: "trigger.manual" },
        steps: [
          {
            id: "flag",
            type: "data.set",
            input: { values: { t: "{{run.test}}" } },
          },
          { id: "w", type: "fn.writer", input: {} },
          {
            id: "mk",
            type: "record.create",
            input: { object: "lead", data: { name: "from-block" } },
          },
          { id: "sub", type: "workflow.run", input: { workflow: "child" } },
        ],
        next: { flag: { ok: ["w"] }, w: { ok: ["mk"] }, mk: { ok: ["sub"] } },
      },
    });
    const r4 = await settle(
      ctx,
      (await runsService.start(ctx, parent.id, { test: true }))!.id,
    );
    assert.equal(r4.status, "succeeded", r4.error ?? "");
    assert.equal(out(r4, "flag").t, true);
    assert.equal(out(r4, "w").test, true);
    const childId = (out(r4, "sub") as { runId: string }).runId;
    const child = await runsService.get(ctx, childId);
    assert.equal(child!.isTest, true);
    assert.equal(out(child!, "c").t, true);
    const leads =
      await sql`select data->>'name' as name, is_test from records where object_id = ${obj.id}`;
    assert.equal(leads.length, 2);
    assert.ok(leads.every((l) => l.is_test));
    const [ev] =
      await sql`select is_test from events where workspace_id = ${ctx.workspaceId} and type = 'fn.wrote'`;
    assert.equal(ev!.is_test, true);
    // Non-test run: nothing flagged.
    const r4b = await settle(
      ctx,
      (await runsService.start(ctx, parent.id))!.id,
    );
    assert.equal(r4b.isTest, false);
    assert.equal(out(r4b, "flag").t, false);
    assert.equal(out(r4b, "w").test, false);

    // A4 + A10: test event linked to a record -> test run, {{event.recordId}}.
    const { record: lead } = await recordsService.upsert(ctx, {
      objectId: obj.id,
      data: { name: "evt" },
      test: true,
    });
    const onEvent = await workflowsService.create(ctx, {
      name: "on-event",
      definition: {
        trigger: { type: "trigger.event", event: "lead.touched" },
        steps: [
          {
            id: "e",
            type: "data.set",
            input: { values: { rid: "{{event.recordId}}", t: "{{run.test}}" } },
          },
        ],
      },
    });
    await workflowsService.activate(ctx, onEvent.id);
    const pushed = await eventsService.insert(ctx, {
      type: "lead.touched",
      recordId: lead.id,
      payload: { source: "x" },
      test: true,
    });
    const [runId] = await resolve({
      name: "event.received",
      data: { ...ctx, id: pushed.id },
    });
    const r10 = await settle(ctx, runId!);
    assert.equal(r10.isTest, true);
    assert.equal(out(r10, "e").rid, lead.id);
    assert.equal(out(r10, "e").t, true);
    await workflowsService.deactivate(ctx, onEvent.id);

    // A5: condition and switch on a step output.
    const branching = {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "decide",
          type: "data.set",
          input: { values: { next: "follow_up", score: 7 } },
        },
        {
          id: "cond",
          type: "condition",
          input: { left: "{{steps.decide.output.score}}", op: "gt", right: 5 },
        },
        {
          id: "sw",
          type: "switch",
          input: {
            value: "{{steps.decide.output.next}}",
            cases: [
              { id: "a", label: "A", op: "eq", value: "routing" },
              { id: "b", label: "B", op: "eq", value: "follow_up" },
            ],
          },
        },
        { id: "yes", type: "data.set", input: { values: { ok: true } } },
      ],
      next: {
        decide: { ok: ["cond"] },
        cond: { true: ["sw"] },
        sw: { b: ["yes"] },
      },
    };
    assert.deepEqual(await workflowsService.validate(ctx, branching), []);
    const bad = structuredClone(branching);
    (bad.steps[2]!.input as { cases: { op: string }[] }).cases[0]!.op = "nope";
    assert.ok((await workflowsService.validate(ctx, bad)).length > 0);
    const wf5 = await workflowsService.create(ctx, {
      name: "branching",
      definition: branching,
    });
    const r5 = await settle(ctx, (await runsService.start(ctx, wf5.id))!.id);
    assert.equal(r5.status, "succeeded", r5.error ?? "");
    assert.deepEqual(
      r5.steps.map((s) => `${s.stepId}:${s.branch}`),
      ["decide:ok", "cond:true", "sw:b", "yes:ok"],
    );

    // A8: a single active execution per key, the next one waits.
    const serial = await workflowsService.create(ctx, {
      name: "serial",
      definition: {
        trigger: { type: "trigger.manual" },
        concurrencyKey: "{{event.company}}",
        steps: [
          { id: "pause", type: "wait", input: { duration: "1s" } },
          { id: "end", type: "data.set", input: { values: { x: 1 } } },
        ],
        next: { pause: { done: ["end"] } },
      },
    });
    const a = await runsService.start(ctx, serial.id, {
      event: { company: "c1" },
    });
    const b = await runsService.start(ctx, serial.id, {
      event: { company: "c1" },
    });
    const other = await runsService.start(ctx, serial.id, {
      event: { company: "c2" },
    });
    const [ra, rb, rc] = [
      await settle(ctx, a!.id),
      await settle(ctx, b!.id),
      await settle(ctx, other!.id),
    ];
    assert.deepEqual(
      [ra.status, rb.status, rc.status],
      ["succeeded", "succeeded", "succeeded"],
    );
    const start = (r: typeof ra) => r.steps[0]!.startedAt!.getTime();
    assert.ok(start(rb) >= ra.finishedAt!.getTime(), "b waits for a to finish");
    assert.ok(start(rc) < ra.finishedAt!.getTime(), "other key: in parallel");

    // A4: the purge removes everything the test run produced, including
    // the errors linked to its runs.
    await sql`insert into errors (organization_id, workspace_id, source, run_id, message)
      values (${ctx.organizationId}, ${ctx.workspaceId}, 'workflow', (select id from workflow_runs where workspace_id = ${ctx.workspaceId} and is_test and status <> 'running' limit 1), 'boom')`;
    const preview = await overviewService.purgeTest(ctx, { dryRun: true });
    assert.equal((preview as { errors: number }).errors, 1);
    const purged = await overviewService.purgeTest(ctx, { confirm: true });
    assert.ok(purged.runs >= 3);
    const left = await sql`select
      (select count(*) from records where workspace_id = ${ctx.workspaceId} and is_test)::int as rec,
      (select count(*) from events where workspace_id = ${ctx.workspaceId} and is_test)::int as ev,
      (select count(*) from workflow_runs where workspace_id = ${ctx.workspaceId} and is_test)::int as runs,
      (select count(*) from errors where workspace_id = ${ctx.workspaceId} and message = 'boom')::int as err`;
    assert.deepEqual(left[0], { rec: 0, ev: 0, runs: 0, err: 0 });
  } finally {
    await worker.close();
  }
});

test("switch / condition: invalid record input does not fall back to value mode", async () => {
  const { switchInput } = await import("../blocks/catalog/switch");
  const { conditionInput, isValueMode } =
    await import("../blocks/catalog/condition");
  const cases = [{ id: "a", label: "A", op: "eq", value: 1 }];
  assert.equal(
    switchInput.safeParse({ object: "o", field: "f", cases }).success,
    false,
  );
  assert.equal(switchInput.safeParse({ value: 1, cases }).success, true);
  assert.equal(
    conditionInput.safeParse({ object: "o", op: "eq" }).success,
    false,
  );
  assert.equal(isValueMode({ condition: {} }), false);
  assert.equal(isValueMode({ left: 1, op: "eq" }), true);
});
