// Integration test of run control: cancellation, pause, retries,
// timeouts, expiry, resume. Requires DATABASE_URL and REDIS_URL.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Worker } from "bullmq";
import { z } from "zod";
import { blocks, defineBlock, getBlock } from "../blocks";
import { queueOptions } from "../bus";
import { appError, errorsService } from "../errors";
import { functionsService } from "../functions";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import type { TenantContext } from "../tenant";
import { resolve } from "../triggers";
import { workflowsService } from "../workflows";
import {
  processStep,
  runsQueue,
  runsService,
  RunAlreadyActive,
  RUNS_QUEUE,
  stepsScope,
} from "./index";

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

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 200; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timeout");
}

// Test blocks: call counter per key, scheduled failures.
const calls: Record<string, number> = {};
const failUntil: Record<string, number> = {};
Object.assign(blocks, {
  "test.flaky": defineBlock({
    type: "test.flaky",
    label: "test.flaky",
    description: "",
    sideEffect: false,
    inputSchema: z.object({ key: z.string() }),
    outputSchema: z.object({ n: z.number() }),
    branches: ["ok", "error"],
    run: async ({ key }) => {
      const n = (calls[key] = (calls[key] ?? 0) + 1);
      if (n <= (failUntil[key] ?? 0)) throw new Error(`failure ${key} #${n}`);
      return { branch: "ok", output: { n } };
    },
  }),
  "test.config": defineBlock({
    type: "test.config",
    label: "test.config",
    description: "",
    sideEffect: false,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    branches: ["ok"],
    run: async () => {
      calls["config"] = (calls["config"] ?? 0) + 1;
      throw appError("blocks.domainNotAllowed", "Domain not allowed: {host}", {
        host: "x.io",
      });
    },
  }),
  "test.hang": defineBlock({
    type: "test.hang",
    label: "test.hang",
    description: "",
    sideEffect: false,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    branches: ["ok"],
    run: () => new Promise<never>(() => {}),
  }),
});

const flaky = (id: string, key = id, extra: object = {}) => ({
  id,
  type: "test.flaky",
  input: { key },
  ...extra,
});

let ctx: TenantContext;
let worker: Worker;
before(async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  ctx = await owner("Control");
});

const startWorker = () =>
  (worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
  }));

const settled = (id: string, ok = (s: string) => s !== "running") =>
  until(
    () => runsService.get(ctx, id),
    (r) => ok(r!.status),
  );

test("stepsScope: path ancestry wins, an error does not overwrite", () => {
  const scope = stepsScope(
    [
      { stepId: "a", path: "0", output: 1, error: null },
      { stepId: "b", path: "0.0", output: "mine", error: null },
      { stepId: "b", path: "0.1", output: "other", error: null },
      { stepId: "a", path: "0.0", output: null, error: "boom" },
    ],
    "0.0",
  );
  assert.deepEqual(scope, { a: { output: 1 }, b: { output: "mine" } });
});

test("stepsScope: a continued failure exposes output.error and error", () => {
  const scope = stepsScope(
    [
      { stepId: "a", path: "0", output: { error: "boom" }, error: "boom" },
      { stepId: "b", path: "0", output: null, error: "dead" },
    ],
    "0",
  );
  assert.deepEqual(scope, { a: { output: { error: "boom" }, error: "boom" } });
});

test("dry run: a function that writes records is simulated", async () => {
  await functionsService.save(ctx, {
    name: "writer",
    code: "export default async () => ({})",
    permissions: { domains: [], secrets: [], records: "write" },
  });
  await functionsService.save(ctx, {
    name: "reader",
    code: "export default async () => ({})",
    permissions: { domains: [], secrets: [], records: "read" },
  });
  assert.equal((await getBlock(ctx, "fn.writer"))!.sideEffect, true);
  assert.equal((await getBlock(ctx, "fn.reader"))!.sideEffect, false);
});

test("cancellation, pause and resume, disabled workflow", async () => {
  const obj = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "A" },
  });
  const wf = await workflowsService.create(ctx, {
    name: "Wait",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        flaky("a", "cancel-a"),
        { id: "w", type: "wait", input: { duration: "1h" } },
        flaky("b", "cancel-b"),
      ],
      next: { a: { ok: ["w"] }, w: { done: ["b"] } },
    },
  });
  startWorker();
  // Cancellation: the run waits 1h, it is canceled and the record is freed.
  const r = await runsService.start(ctx, wf.id, { recordId: record.id });
  await until(
    () => runsService.get(ctx, r!.id),
    (x) => x!.stepCount === 2,
  );
  assert.equal(await runsService.cancel(ctx, r!.id), true);
  assert.equal(await runsService.cancel(ctx, r!.id), false);
  const canceled = await runsService.get(ctx, r!.id);
  assert.equal(canceled!.status, "canceled");
  assert.ok(canceled!.finishedAt);
  assert.ok(
    Object.values(canceled!.paths as Record<string, { status: string }>).every(
      (p) => p.status !== "running",
    ),
  );
  const r2 = await runsService.start(ctx, wf.id, { recordId: record.id });
  await assert.rejects(
    runsService.start(ctx, wf.id, { recordId: record.id }),
    RunAlreadyActive,
  );
  // Bulk cancellation by workflow.
  assert.equal(await runsService.cancelBulk(ctx, { workflowId: wf.id }), 1);
  assert.equal((await runsService.get(ctx, r2!.id))!.status, "canceled");
  await assert.rejects(runsService.cancelBulk(ctx, {}));

  // Pause: the next step is not executed before resume.
  await worker.close();
  const quick = await workflowsService.create(ctx, {
    name: "Fast",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [flaky("a", "pause-a"), flaky("b", "pause-b")],
      next: { a: { ok: ["b"] } },
    },
  });
  const p = await runsService.start(ctx, quick.id);
  assert.equal(await runsService.pause(ctx, p!.id), true);
  startWorker();
  await new Promise((res) => setTimeout(res, 500));
  assert.equal(calls["pause-a"], undefined);
  assert.equal((await runsService.get(ctx, p!.id))!.status, "paused");
  assert.equal(await runsService.resume(ctx, p!.id), true);
  assert.equal((await settled(p!.id))!.status, "succeeded");
  assert.equal(calls["pause-b"], 1);

  // Disabled workflow: its running run is canceled at the next step.
  await worker.close();
  const off = await runsService.start(ctx, quick.id);
  await workflowsService.update(ctx, quick.id, { status: "active" });
  await workflowsService.deactivate(ctx, quick.id);
  startWorker();
  const stopped = await settled(off!.id);
  assert.equal(stopped!.status, "canceled");
  assert.equal(stopped!.error, "Workflow deactivated");
  await worker.close();
});

test("retry per step, continueOnFail, timeout, loop without replaying iterations", async () => {
  startWorker();
  failUntil["retry"] = 1;
  failUntil["dead"] = 99;
  const wf = await workflowsService.create(ctx, {
    name: "Retry",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        flaky("a", "retry", { retry: { attempts: 2, backoff: "1s" } }),
        flaky("b", "dead", { retry: { attempts: 1, continueOnFail: true } }),
        { id: "c", type: "test.flaky", input: { key: "{{steps.b.output.error}}" } },
      ],
      next: { a: { ok: ["b"] }, b: { error: ["c"] } },
    },
  });
  const invalid = await workflowsService.validate(ctx, {
    trigger: { type: "trigger.manual" },
    steps: [flaky("a", "x", { retry: { attempts: 0 } })],
  });
  assert.equal(invalid.length, 1);
  assert.match(invalid[0]!, /^a\.retry\.attempts: /);
  const r = await runsService.start(ctx, wf.id);
  const done = await settled(r!.id);
  assert.equal(done!.status, "succeeded");
  assert.deepEqual(
    done!.steps.map((s) => [s.stepId, s.branch, s.attempts, !!s.error]),
    [
      ["a", "ok", 2, false],
      ["b", "error", 1, true],
      ["c", "ok", 1, false],
    ],
  );
  assert.ok(done!.steps[0]!.startedAt);
  // continueOnFail: the next step reads the failure in steps.b.output.error.
  assert.deepEqual(done!.steps[2]!.input, { key: "failure dead #1" });
  // Handled by the error branch: no error center entry.
  assert.equal(
    (await errorsService.list(ctx, { runId: r!.id })).items.length,
    0,
  );

  // Configuration error: no new attempt despite the retry policy, no stack.
  const conf = await workflowsService.create(ctx, {
    name: "Config",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "x",
          type: "test.config",
          input: {},
          retry: { attempts: 3, backoff: "1s" },
        },
      ],
    },
  });
  const cf = await settled((await runsService.start(ctx, conf.id))!.id);
  assert.equal(cf!.status, "failed");
  assert.equal(cf!.steps[0]!.attempts, 1);
  assert.equal(calls["config"], 1);
  const stored = await until(
    () => errorsService.list(ctx, { runId: cf!.id }),
    (l) => l.items.length > 0,
  );
  assert.equal(stored.items[0]!.stack, null);

  // Step timeout: the block that does not answer fails after 1 s.
  const slow = await workflowsService.create(ctx, {
    name: "Lent",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "h",
          type: "test.hang",
          input: {},
          timeout: "1s",
          retry: { attempts: 1 },
        },
      ],
    },
  });
  const s = await settled((await runsService.start(ctx, slow.id))!.id);
  assert.equal(s!.status, "failed");
  assert.match(s!.steps[0]!.error!, /Timed out/);

  // Loop: iteration 1 fails once; on retry, iteration 0 is
  // not redone.
  failUntil["it-1"] = 1;
  const lp = await workflowsService.create(ctx, {
    name: "Boucle",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "l",
          type: "loop",
          input: {
            items: ["0", "1"],
            do: [
              { id: "x", type: "test.flaky", input: { key: "it-{{item}}" } },
            ],
          },
          retry: { attempts: 2, backoff: "1s" },
        },
      ],
    },
  });
  const l = await settled((await runsService.start(ctx, lp.id))!.id);
  assert.equal(l!.status, "succeeded");
  assert.equal(calls["it-0"], 1);
  assert.equal(calls["it-1"], 2);
  assert.equal(l!.steps[0]!.attempts, 2);
  await worker.close();
});

test("human.approve expiry, retry_from, replay, paginated list", async () => {
  startWorker();
  const wf = await workflowsService.create(ctx, {
    name: "Validation",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        { id: "ok", type: "human.approve", input: { timeout: "1s" } },
        flaky("late", "expired-path"),
      ],
      next: { ok: { expired: ["late"] } },
    },
  });
  const r = await settled((await runsService.start(ctx, wf.id))!.id, (st) =>
    ["succeeded", "failed"].includes(st),
  );
  assert.equal(r!.status, "succeeded");
  assert.deepEqual(
    r!.steps.map((s) => [s.stepId, s.branch]),
    [
      ["ok", "expired"],
      ["late", "ok"],
    ],
  );
  // Without an "expired" follow-up: visible failure.
  const strict = await workflowsService.create(ctx, {
    name: "Validation stricte",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [{ id: "ok", type: "human.approve", input: { timeout: "1s" } }],
    },
  });
  const f = await settled((await runsService.start(ctx, strict.id))!.id, (st) =>
    ["succeeded", "failed"].includes(st),
  );
  assert.equal(f!.status, "failed");
  assert.match(f!.error!, /expired without a decision/);

  // retry_from: the rest of the path is replayed, the previous step kept.
  const lin = await workflowsService.create(ctx, {
    name: "Linear",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [flaky("a", "rf-a"), flaky("b", "rf-b")],
      next: { a: { ok: ["b"] } },
    },
  });
  const first = await settled((await runsService.start(ctx, lin.id))!.id);
  assert.equal(first!.status, "succeeded");
  assert.equal(await runsService.retryFrom(ctx, first!.id, "b"), true);
  const again = await settled(first!.id);
  assert.equal(again!.status, "succeeded");
  assert.deepEqual(
    again!.steps.map((s) => s.stepId),
    ["a", "b"],
  );
  assert.equal(calls["rf-a"], 1);
  assert.equal(calls["rf-b"], 2);
  await assert.rejects(runsService.retryFrom(ctx, first!.id, "zzz"));

  // replay: new run of the same version.
  const replay = await runsService.replay(ctx, first!.id);
  assert.notEqual(replay!.id, first!.id);
  assert.equal(replay!.version, first!.version);
  assert.equal((await settled(replay!.id))!.status, "succeeded");

  // List filtered and cursor-paginated.
  const page1 = await runsService.list(ctx, { workflowId: lin.id, limit: 1 });
  assert.equal(page1.items.length, 1);
  assert.equal(page1.items[0]!.id, replay!.id);
  const page2 = await runsService.list(ctx, {
    workflowId: lin.id,
    limit: 1,
    cursor: page1.nextCursor!,
  });
  assert.equal(page2.items[0]!.id, first!.id);
  assert.equal(page2.nextCursor, null);
  // Malformed cursor: first page, no SQL error.
  const bad = await runsService.list(ctx, {
    workflowId: lin.id,
    limit: 1,
    cursor: "pas-un-uuid",
  });
  assert.equal(bad.items[0]!.id, replay!.id);
  const future = await runsService.list(ctx, {
    workflowId: lin.id,
    from: new Date(Date.now() + 60_000),
  });
  assert.equal(future.items.length, 0);
  await worker.close();
});

test("trigger: already active run visible in errors, bus replayed without duplicate", async () => {
  const obj = await objectsService.create(ctx, {
    slug: "lead",
    name: "Lead",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const wf = await workflowsService.create(ctx, {
    name: "On create",
    definition: {
      trigger: { type: "trigger.record_created", object: "lead" },
      steps: [{ id: "w", type: "wait", input: { duration: "1h" } }],
    },
  });
  await workflowsService.activate(ctx, wf.id);
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "L" },
  });
  const job = {
    name: "record.created" as const,
    data: { ...ctx, id: record.id, key: crypto.randomUUID() },
  };
  const [id] = await resolve(job);
  // Same publication replayed: same run, no error.
  assert.deepEqual(await resolve(job), [id]);
  const before = (await errorsService.list(ctx, { source: "workflow" })).items
    .length;
  // Other publication while the run is running: ignored but visible.
  assert.deepEqual(
    await resolve({ ...job, data: { ...job.data, key: crypto.randomUUID() } }),
    [],
  );
  const errs = await errorsService.list(ctx, { source: "workflow" });
  assert.equal(errs.items.length, before + 1);
  assert.match(errs.items[0]!.message, /already in progress/);
  await runsService.cancel(ctx, id!);
});
