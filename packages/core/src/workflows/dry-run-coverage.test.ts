// Activation coverage: dry runs add up per definition hash, per-record
// pins and `events` cover several branches in one call, and the untested
// error names the real blocker. Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { workflowsService as wf } from "./index";

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

const manual = { type: "trigger.manual" };
const memoObject = (a: TenantContext) =>
  objectsService.create(a, {
    slug: "memo",
    name: "Memo",
    fields: [{ key: "title", label: "Title", type: "text" }],
  });
const save = (id: string, title: string) => ({
  id,
  type: "record.create",
  input: { object: "memo", data: { title } },
});

test("human.approve: coverage adds up across calls, pins keep the hash, per-record pins cover every decision", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("Approve");
  const memo = await memoObject(a);
  const definition = {
    trigger: manual,
    steps: [
      { id: "ask", type: "human.approve", input: { message: "Ok?" } },
      save("yes", "approved"),
      save("no", "rejected"),
    ],
    // A single target id is accepted and stored as a list.
    next: { ask: { approved: "yes", rejected: ["no"] } },
  };
  const w = await wf.create(a, { name: "Approve", definition });
  const saved = (await wf.get(a, w.id))!;
  assert.deepEqual(saved.definition.next!.ask!.approved, ["yes"]);

  // Two calls, one decision each: the second completes the coverage.
  const first = (await wf.dryRunWorkflow(a, w.id, [], {
    definition: { ...definition, pins: { ask: { branch: "approved" } } },
  }))!;
  assert.equal(first.tested, false);
  assert.deepEqual(first.unreachedWrites, ["no"]);
  await assert.rejects(wf.activateTested(a, w.id), (e: Error) => {
    assert.match(e.message, /blocked by: .*side-effect steps no/);
    assert.match(e.message, /pin/);
    return true;
  });
  const second = (await wf.dryRunWorkflow(a, w.id, [], {
    definition: { ...definition, pins: { ask: { branch: "rejected" } } },
  }))!;
  assert.equal(second.tested, true);
  assert.deepEqual(second.coverage.unreached, []);
  // The pinned inline definition counts for the saved version.
  assert.equal((await wf.activateTested(a, w.id))!.status, "active");

  // One call: each record carries its own decision.
  const up = (externalId: string) =>
    recordsService.upsert(a, {
      objectId: memo.id,
      externalId,
      data: { title: externalId },
    });
  const r1 = await up("m1");
  const r2 = await up("m2");
  const w2 = await wf.create(a, { name: "Approve2", definition });
  const one = (await wf.dryRunWorkflow(a, w2.id, [
    { id: r1.record.id, pins: { ask: { branch: "approved" } } },
    { id: r2.record.id, pins: { ask: { branch: "rejected" } } },
  ]))!;
  assert.equal(one.results.length, 2);
  assert.equal(one.tested, true);
  assert.deepEqual(one.unreachedWrites, []);
});

test("switch: events cover every branch in one call; trigger.event without event is a clear error", async () => {
  const a = await owner("Switch");
  await memoObject(a);
  const definition = {
    trigger: { type: "trigger.event", event: "lead.scored" },
    steps: [
      {
        id: "sw",
        type: "switch",
        input: {
          value: "{{event.tier}}",
          cases: [{ id: "gold", label: "Gold", op: "eq", value: "gold" }],
        },
      },
      save("vip", "vip"),
      save("std", "std"),
      { id: "ping", type: "event.emit", input: { type: "memo.done" } },
    ],
    next: { sw: { gold: ["vip"], else: ["std"] }, vip: { ok: ["ping"] } },
  };
  const w = await wf.create(a, { name: "Switch", definition });
  await assert.rejects(wf.dryRunWorkflow(a, w.id), {
    code: "workflows.dryRunEventMissing",
  });
  const gold = (await wf.dryRunWorkflow(a, w.id, [], {
    event: { tier: "gold" },
  }))!;
  assert.equal(gold.tested, false);
  assert.deepEqual(gold.unreachedWrites, ["std"]);
  const ping = gold.results[0]!.path.find((s) => s.stepId === "ping")!;
  assert.deepEqual(ping.output, {
    eventId: "dry",
    id: "dry",
    duplicate: false,
  });

  const w2 = await wf.create(a, { name: "Switch2", definition });
  const both = (await wf.dryRunWorkflow(a, w2.id, [], {
    events: [{ tier: "gold" }, { tier: "silver" }],
  }))!;
  assert.equal(both.results.length, 2);
  assert.equal(both.tested, true);
});

test("explicit empty branch = deliberate end; pinned stop.error = expected outcome; missing secret takes the error branch", async () => {
  const a = await owner("Ends");
  const definition = {
    trigger: manual,
    steps: [
      {
        id: "c",
        type: "condition",
        input: { left: "a", op: "eq", right: "b" },
      },
      { id: "s2", type: "wait", input: { duration: "1s" } },
    ],
    next: { c: { true: ["s2"], false: [] } },
  };
  const w = await wf.create(a, { name: "Ends", definition });
  const dry = (await wf.dryRunWorkflow(a, w.id))!;
  assert.equal(dry.tested, true);
  assert.match(dry.results[0]!.warnings!.join("\n"), /declared empty/);

  const stop = {
    trigger: manual,
    steps: [
      { id: "s1", type: "wait", input: { duration: "1s" } },
      { id: "halt", type: "stop.error", input: { message: "No" } },
    ],
    next: { s1: { done: ["halt"] } },
    pins: { halt: { error: "forced" } },
  };
  const [pinned] = await wf.dryRun(a, stop);
  assert.equal(pinned!.error, undefined);
  assert.match(pinned!.path.at(-1)!.reason, /stops the run: forced/);

  const secret = {
    trigger: manual,
    steps: [
      {
        id: "call",
        type: "http.request",
        input: {
          url: "https://example.com",
          headers: { Authorization: "Bearer {{secret.NOPE}}" },
        },
        retry: { continueOnFail: true },
      },
      { id: "handled", type: "wait", input: { duration: "1s" } },
    ],
    next: { call: { error: ["handled"] } },
  };
  const [run] = await wf.dryRun(a, secret);
  assert.equal(run!.error, undefined);
  assert.equal(run!.path[0]!.branch, "error");
  assert.equal(run!.path.at(-1)!.stepId, "handled");
});
