// Run reliability: outbox + sweeper, waits in DB, abort at
// timeout. Requires DATABASE_URL and REDIS_URL. Redis: dedicated logical database
// (13), flushed by the FLUSHDB test without touching other processes.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import postgres from "postgres";
import { Worker } from "bullmq";
import { z } from "zod";

const redisBase = (process.env.REDIS_URL ?? "redis://127.0.0.1:6380").replace(
  /\/\d+$/,
  "",
);
process.env.REDIS_URL = `${redisBase}/13`;

const { blocks, defineBlock } = await import("../blocks");
const { busConnection, queueOptions } = await import("../bus");
const { workflowsService } = await import("../workflows");
const { workspacesService } = await import("../workspaces");
const { processStep, runsQueue, runsService, sweepRunOutbox, RUNS_QUEUE } =
  await import("./index");
type TenantContext = import("../tenant").TenantContext;

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

blocks["test.ok"] = defineBlock({
  type: "test.ok",
  label: "test.ok",
  description: "",
  sideEffect: false,
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  branches: ["ok"],
  run: async () => ({ branch: "ok", output: { ok: true } }),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settle(ctx: TenantContext, runId: string, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    const run = await runsService.get(ctx, runId);
    if (run && !["running", "waiting"].includes(run.status)) return run;
    if (Date.now() > end) throw new Error(`run ${runId} still ${run?.status}`);
    await sleep(100);
  }
}
const outboxRows = async (runId: string) =>
  (await sql`select count(*)::int as n from run_outbox where run_id = ${runId}`)[0]!
    .n as number;
const worker = () =>
  new Worker(RUNS_QUEUE, processStep, { ...queueOptions(), concurrency: 4 });

// The sweeper is global: rows left by other test files
// (runs interrupted with their worker) would skew the counts.
beforeEach(async () => {
  await sql`delete from run_outbox`;
});

test("crash between commit and enqueue: the sweeper resumes the run", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("Outbox");
  const wf = await workflowsService.create(ctx, {
    name: "Outbox",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [{ id: "a", type: "test.ok", input: {} }],
    },
  });
  // Redis unavailable right after the run commit.
  const q = runsQueue();
  const add = q.add.bind(q);
  q.add = async () => {
    throw new Error("redis down");
  };
  const run = await runsService.start(ctx, wf.id).finally(() => {
    q.add = add;
  });
  assert.ok(run, "the run is created despite the enqueue failure");
  assert.equal(await outboxRows(run.id), 1);
  assert.equal((await q.getJobs(["waiting", "prioritized"])).length, 0);

  const w = worker();
  try {
    await sleep(500);
    assert.equal((await runsService.get(ctx, run.id))!.status, "running");
    // Row not due yet (grace period): nothing to resume.
    assert.equal(await sweepRunOutbox(), 0);
    assert.equal(await sweepRunOutbox({ graceMs: 0 }), 1);
    const done = await settle(ctx, run.id);
    assert.equal(done.status, "succeeded");
    assert.equal(await outboxRows(run.id), 0);
    // Replaying the sweeper restarts nothing.
    assert.equal(await sweepRunOutbox({ graceMs: 0 }), 0);
  } finally {
    await w.close();
  }
});

test("step timeout: the http request is aborted", async () => {
  let aborted: number | undefined;
  let received: number | undefined;
  const server = createServer((req) => {
    received = Date.now();
    // Never answers: only the client abort closes the connection.
    req.on("close", () => (aborted = Date.now()));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/slow`;
  const ctx = await owner("Abort");
  await workspacesService.setSettings(ctx, { allowedDomains: ["127.0.0.1"] });
  const wf = await workflowsService.create(ctx, {
    name: "Lent",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "call",
          type: "http.request",
          input: { url },
          timeout: "1s",
          retry: { attempts: 1 },
        },
      ],
    },
  });
  // Local server: private network allowed for the duration of the test (SSRF filter).
  process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK = "1";
  const w = worker();
  try {
    const run = await runsService.start(ctx, wf.id);
    const done = await settle(ctx, run!.id);
    assert.equal(done.status, "failed");
    assert.match(done.error ?? "", /Timed out \(1 s\)/);
    for (let i = 0; i < 20 && aborted === undefined; i++) await sleep(100);
    assert.ok(received && aborted, "connection closed by the client");
    assert.ok(aborted - received < 3000, `abort after ${aborted - received} ms`);
  } finally {
    delete process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
    await w.close();
    server.closeAllConnections();
    server.close();
  }
});

test("a wait survives a Redis FLUSHDB", async () => {
  const ctx = await owner("Flush");
  const wf = await workflowsService.create(ctx, {
    name: "Wait",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        { id: "w", type: "wait", input: { duration: "2s" } },
        { id: "a", type: "test.ok", input: {} },
      ],
      next: { w: { done: ["a"] } },
    },
  });
  let w = worker();
  const run = (await runsService.start(ctx, wf.id))!;
  // The wait is executed: the next step waits in Redis and in DB.
  for (let i = 0; i < 100; i++) {
    const r = await runsService.get(ctx, run.id);
    if (r!.steps.some((s) => s.stepId === "w")) break;
    await sleep(50);
  }
  await w.close();
  // timestamp without time zone, written in UTC by the application.
  const [row] =
    await sql`select wait_until::text as at from run_outbox where run_id = ${run.id}`;
  const due = new Date(`${row?.at}Z`);
  assert.ok(due > new Date(), "due date persisted in DB");

  const redis = busConnection();
  await redis.flushdb();
  await redis.quit();
  assert.equal(await runsQueue().getJobCounts().then((c) => c.delayed), 0);

  w = worker();
  try {
    // Before the due date: nothing to resume.
    assert.equal(await sweepRunOutbox({ graceMs: 0 }), 0);
    await sleep(Math.max(0, due.getTime() - Date.now()) + 100);
    assert.equal(await sweepRunOutbox({ graceMs: 0 }), 1);
    const done = await settle(ctx, run.id);
    assert.equal(done.status, "succeeded");
    assert.deepEqual(
      done.steps.map((s) => s.stepId),
      ["w", "a"],
    );
  } finally {
    await w.close();
  }
});
