// Integration test: requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Worker } from "bullmq";
import { z } from "zod";
import { blocks, defineBlock } from "../blocks";
import { queueOptions } from "../bus";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import type { TenantContext } from "../tenant";
import { workflowsService } from "../workflows";
import {
  processStep,
  render,
  runsQueue,
  runsService,
  RunAlreadyActive,
  RUNS_QUEUE,
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

// Test blocks: branching qualification, echo, and a block that "crashes"
// the worker on the first call (never returns).
let hang = true;
Object.assign(blocks, {
  "test.qualify": defineBlock({
    type: "test.qualify",
    label: "test.qualify",
    description: "",
    sideEffect: false,
    inputSchema: z.object({ size: z.number() }),
    outputSchema: z.object({ reason: z.string() }),
    branches: ["hot", "cold"],
    run: async ({ size }) => ({
      branch: size > 10 ? "hot" : "cold",
      output: { reason: `taille ${size}` },
      cost: 0.5,
    }),
  }),
  "test.echo": defineBlock({
    type: "test.echo",
    label: "test.echo",
    description: "",
    sideEffect: false,
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ text: z.string() }),
    branches: ["ok"],
    run: async ({ text }) => {
      if (text.startsWith("crash") && hang) {
        hang = false;
        await new Promise(() => {});
      }
      return { branch: "ok", output: { text } };
    },
  }),
});

// Block that always fails (after its retries).
blocks["test.fail"] = defineBlock({
  type: "test.fail",
  label: "test.fail",
  description: "",
  sideEffect: false,
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  branches: ["ok"],
  run: async () => {
    throw new Error("boom");
  },
});

const definition = (
  echo = "{{steps.qualify.output.reason}} / {{record.data.name}}",
) => ({
  trigger: { type: "trigger.manual" },
  steps: [
    { id: "get", type: "record.get", input: { id: "{{record.id}}" } },
    {
      id: "qualify",
      type: "test.qualify",
      input: { size: "{{steps.get.output.record.data.size}}" },
    },
    { id: "hot", type: "test.echo", input: { text: echo } },
    { id: "cold", type: "test.echo", input: { text: "froid" } },
  ],
  next: { get: { found: ["qualify"] }, qualify: { hot: ["hot"], cold: ["cold"] } },
});

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 200; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timeout");
}

test("render replaces variables", () => {
  const scope = { record: { x: 3 }, steps: { q: { output: { r: "ok" } } } };
  assert.deepEqual(
    render({ a: "{{record.x}}", b: "r={{steps.q.output.r}}" }, scope),
    {
      a: 3,
      b: "r=ok",
    },
  );
});

test("3-step workflow with branch, safeguard, resume after crash", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("Runs");
  const obj = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "size", label: "Taille", type: "number" },
    ],
  });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "Acme", size: 42 },
  });

  const opts = {
    ...queueOptions(),
    lockDuration: 1000,
    stalledInterval: 500,
  };
  let worker = new Worker(RUNS_QUEUE, processStep, opts);

  // End to end: get -> qualify -(hot)-> hot.
  const wf = await workflowsService.create(ctx, {
    name: "Qualif",
    definition: definition(),
  });
  const run = await runsService.start(ctx, wf.id, { recordId: record.id });
  await assert.rejects(
    runsService.start(ctx, wf.id, { recordId: record.id }),
    RunAlreadyActive,
  );
  const done = await until(
    () => runsService.get(ctx, run!.id),
    (r) => r!.status !== "running",
  );
  assert.equal(done!.status, "succeeded");
  assert.deepEqual(
    done!.steps.map((s) => [s.stepId, s.branch]),
    [
      ["get", "found"],
      ["qualify", "hot"],
      ["hot", "ok"],
    ],
  );
  assert.equal(done!.steps[1]!.cost, 0.5);
  assert.deepEqual(done!.steps[2]!.output, { text: "taille 42 / Acme" });
  // Finished run: a new run is allowed.
  const again = await runsService.start(ctx, wf.id, { recordId: record.id });
  await until(
    () => runsService.get(ctx, again!.id),
    (r) => r!.status !== "running",
  );
  // Record page: runs of the record, most recent first, with steps.
  const forRecord = await runsService.forRecord(ctx, record.id);
  assert.deepEqual(
    forRecord.map((r) => r.id),
    [again!.id, run!.id],
  );
  assert.equal(forRecord[1]!.workflowName, wf.name);
  assert.equal(forRecord[1]!.steps.length, done!.steps.length);

  // Crash: the worker dies during step 3, another one resumes that step.
  const wf2 = await workflowsService.create(ctx, {
    name: "Crash",
    definition: definition("crash {{record.data.name}}"),
  });
  const r2 = await runsService.start(ctx, wf2.id, { recordId: record.id });
  await until(
    () => runsService.get(ctx, r2!.id),
    (r) => r!.stepCount === 2,
  );
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(hang, false); // block stuck in progress
  await worker.close(true);
  worker = new Worker(RUNS_QUEUE, processStep, opts);
  const resumed = await until(
    () => runsService.get(ctx, r2!.id),
    (r) => r!.status !== "running",
  );
  assert.equal(resumed!.status, "succeeded");
  assert.deepEqual(
    resumed!.steps.map((s) => s.stepId),
    ["get", "qualify", "hot"],
  );
  assert.deepEqual(resumed!.steps[2]!.output, { text: "crash Acme" });

  // Infinite loop: stopped by the limit.
  const loop = await workflowsService.create(ctx, {
    name: "Loop",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [{ id: "a", type: "test.echo", input: { text: "x" } }],
      next: { a: { ok: ["a"] } },
    },
  });
  const r3 = await runsService.start(ctx, loop.id);
  const stopped = await until(
    () => runsService.get(ctx, r3!.id),
    (r) => r!.status !== "running",
  );
  assert.equal(stopped!.status, "failed");
  assert.match(stopped!.error!, /Limit of/);
  await worker.close();
});

test("wait survives a worker restart, approve resumes, loop iterates", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("Control");
  const opts = queueOptions();
  let worker = new Worker(RUNS_QUEUE, processStep, opts);

  // wait 2s: the worker stops during the wait, a new one resumes.
  const wf = await workflowsService.create(ctx, {
    name: "Wait",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        { id: "w", type: "wait", input: { duration: "2s" } },
        { id: "e", type: "test.echo", input: { text: "later" } },
      ],
      next: { w: { done: ["e"] } },
    },
  });
  const r1 = await runsService.start(ctx, wf.id);
  await until(
    () => runsService.get(ctx, r1!.id),
    (r) => r!.stepCount === 1,
  );
  await worker.close();
  assert.equal((await runsService.get(ctx, r1!.id))!.status, "running");
  worker = new Worker(RUNS_QUEUE, processStep, opts);
  const waited = await until(
    () => runsService.get(ctx, r1!.id),
    (r) => r!.status !== "running",
  );
  assert.equal(waited!.status, "succeeded");
  assert.ok(
    waited!.steps[1]!.createdAt.getTime() -
      waited!.steps[0]!.createdAt.getTime() >=
      1500,
  );

  // human.approve: pause, then decision through the service (called by the UI).
  const approval = await workflowsService.create(ctx, {
    name: "Validation",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        { id: "ok", type: "human.approve", input: { message: "Go ?" } },
        { id: "yes", type: "test.echo", input: { text: "oui" } },
        { id: "no", type: "test.echo", input: { text: "non" } },
      ],
      next: { ok: { approved: ["yes"], rejected: ["no"] } },
    },
  });
  for (const approved of [true, false]) {
    // Started by name: the run carries the resolved workflow id.
    const r = await runsService.start(ctx, "Validation");
    assert.equal(r!.workflowId, approval.id);
    const w = await until(
      () => runsService.get(ctx, r!.id),
      (x) => x!.status === "waiting",
    );
    assert.equal(
      (w!.paths as Record<string, { message?: string }>)["0"]!.message,
      "Go ?",
    );
    assert.ok((await runsService.waiting(ctx)).some((x) => x.id === r!.id));
    assert.ok(
      (await runsService.list(ctx, { status: "waiting" })).items.some(
        (x) => x.id === r!.id,
      ),
    );
    const decided = await runsService.decide(
      ctx,
      r!.id,
      approved,
      undefined,
      "checked",
    );
    assert.ok(decided);
    assert.equal(decided.runId, r!.id);
    assert.equal(decided.branch, approved ? "approved" : "rejected");
    assert.equal(await runsService.decide(ctx, r!.id, approved), false);
    const done = await until(
      () => runsService.get(ctx, r!.id),
      (x) => x!.status === "succeeded",
    );
    assert.deepEqual(
      done!.steps.map((s) => [s.stepId, s.branch]),
      [
        ["ok", approved ? "approved" : "rejected"],
        [approved ? "yes" : "no", "ok"],
      ],
    );
    const out = done!.steps[0]!.output as Record<string, unknown>;
    assert.equal(out.message, "Go ?");
    assert.equal(out.approved, approved);
    assert.equal(out.comment, "checked");
    assert.ok(typeof out.decidedAt === "string");
    assert.ok(Array.isArray((out.by as { scopes: unknown }).scopes));
  }

  // loop: subgraph over a list, capped by limit.
  const lp = await workflowsService.create(ctx, {
    name: "Loop liste",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "l",
          type: "loop",
          input: {
            items: ["a", "b", "c"],
            limit: 2,
            do: [
              {
                id: "x",
                type: "test.echo",
                input: { text: "{{index}}:{{item}}" },
              },
              {
                id: "y",
                type: "test.echo",
                input: { text: "{{steps.x.output.text}}!" },
              },
            ],
          },
        },
      ],
    },
  });
  const r3 = await runsService.start(ctx, lp.id);
  const looped = await until(
    () => runsService.get(ctx, r3!.id),
    (r) => r!.status !== "running",
  );
  assert.equal(looped!.status, "succeeded");
  const loopOut = looped!.steps[0]!.output as {
    results: unknown[];
    iterations: { index: number }[];
    truncated: boolean;
  };
  assert.deepEqual(loopOut.results, [
    { x: { text: "0:a" }, y: { text: "0:a!" } },
    { x: { text: "1:b" }, y: { text: "1:b!" } },
  ]);
  assert.deepEqual(
    loopOut.iterations.map((i) => i.index),
    [0, 1],
  );
  assert.equal(loopOut.truncated, true);
  await worker.close();
});

test("templates with relation paths in a record.update", async () => {
  const ctx = await owner("RunsRel");
  const ent = await objectsService.create(ctx, {
    slug: "companies",
    name: "Companies",
    fields: [{ key: "nom", label: "Name", type: "text" }],
  });
  const ct = await objectsService.create(ctx, {
    slug: "contacts",
    name: "Contacts",
    fields: [
      { key: "name", label: "Name", type: "text" },
      {
        key: "entreprise",
        label: "Company",
        type: "ref",
        object: "companies",
      },
    ],
  });
  const dl = await objectsService.create(ctx, {
    slug: "deals",
    name: "Deals",
    fields: [
      { key: "note", label: "Note", type: "text" },
      { key: "contact", label: "Contact", type: "ref", object: "contacts" },
    ],
  });
  const e = await recordsService.upsert(ctx, {
    objectId: ent.id,
    data: { nom: "Acme" },
  });
  const c = await recordsService.upsert(ctx, {
    objectId: ct.id,
    data: { name: "Ada", entreprise: e.record.id },
  });
  const d = await recordsService.upsert(ctx, {
    objectId: dl.id,
    data: { contact: c.record.id },
  });
  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
  });
  const wf = await workflowsService.create(ctx, {
    name: "Rel",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "upd",
          type: "record.update",
          input: {
            recordId: "{{record.id}}",
            data: {
              note: "{{record.contact.entreprise.nom}} / {{record.contact.name}}",
            },
          },
        },
        {
          id: "echo",
          type: "test.echo",
          input: { text: "{{steps.upd.output.record.contact.entreprise.nom}}" },
        },
      ],
      next: { upd: { ok: ["echo"] } },
    },
  });
  const run = await runsService.start(ctx, wf.id, { recordId: d.record.id });
  const done = await until(
    () => runsService.get(ctx, run!.id),
    (r) => r!.status !== "running",
  );
  assert.equal(done!.status, "succeeded", JSON.stringify(done!.steps));
  const after = await recordsService.get(ctx, d.record.id);
  assert.equal(after.data.note, "Acme / Ada");
  assert.deepEqual(done!.steps[1]!.output, { text: "Acme" });
  // Max depth: beyond 3 hops, nothing is resolved.
  const deep = await recordsService.resolvePaths(ctx, d.record.id, [
    "contact.entreprise.nom",
    "contact.inconnu",
  ]);
  assert.deepEqual(deep, {
    "contact.entreprise.nom": "Acme",
    "contact.inconnu": undefined,
  });
  await worker.close();
});

test("parallel paths: multiple entries, branch with several targets, failure, wait", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("Parallel");
  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
  });
  const echo = (id: string) => ({ id, type: "test.echo", input: { text: id } });
  const finished = (id: string) =>
    until(
      () => runsService.get(ctx, id),
      (r) => r!.status === "succeeded" || r!.status === "failed",
    );
  const byPath = (steps: { path: string; stepId: string }[]) =>
    steps
      .map((s) => `${s.path}:${s.stepId}`)
      .sort((a, b) => a.localeCompare(b));

  // Trigger -> [a, b].
  const both = await workflowsService.create(ctx, {
    name: "Two entries",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [echo("a"), echo("b")],
      entry: ["a", "b"],
    },
  });
  const r1 = await finished((await runsService.start(ctx, both.id))!.id);
  assert.equal(r1!.status, "succeeded");
  assert.equal(r1!.stepCount, 2);
  assert.deepEqual(byPath(r1!.steps), ["0:a", "1:b"]);

  // hot branch -> [c, d] (and cold as a plain string, the old form).
  const split = await workflowsService.create(ctx, {
    name: "Branch multiple",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        { id: "q", type: "test.qualify", input: { size: 42 } },
        echo("c"),
        echo("d"),
        echo("e"),
      ],
      next: { q: { hot: ["c", "d"], cold: ["e"] }, c: { ok: ["e"] } },
    },
  });
  const r2 = await finished((await runsService.start(ctx, split.id))!.id);
  assert.equal(r2!.status, "succeeded");
  assert.deepEqual(byPath(r2!.steps), ["0:q", "0.0:c", "0.0:e", "0.1:d"]);
  assert.equal(r2!.steps.find((s) => s.stepId === "q")!.cost, 0.5);

  // Failure on one path: the other runs to the end, then the run is failed.
  const fail = await workflowsService.create(ctx, {
    name: "Partial failure",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        { id: "ko", type: "test.fail", input: {} },
        echo("ok1"),
        echo("ok2"),
      ],
      entry: ["ko", "ok1"],
      next: { ok1: { ok: ["ok2"] } },
    },
  });
  const r3 = await finished((await runsService.start(ctx, fail.id))!.id);
  assert.equal(r3!.status, "failed");
  assert.match(r3!.error!, /boom/);
  assert.deepEqual(byPath(r3!.steps), ["0:ko", "1:ok1", "1:ok2"]);
  assert.equal(r3!.steps.find((s) => s.stepId === "ko")!.error, "boom");

  // wait on one path while the other finishes.
  const wait = await workflowsService.create(ctx, {
    name: "Parallel wait",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        { id: "w", type: "wait", input: { duration: "2s" } },
        echo("later"),
        echo("vite"),
      ],
      entry: ["w", "vite"],
      next: { w: { done: ["later"] } },
    },
  });
  const r4 = await runsService.start(ctx, wait.id);
  const mid = await until(
    () => runsService.get(ctx, r4!.id),
    (r) => r!.steps.some((s) => s.stepId === "vite"),
  );
  assert.equal(mid!.status, "running");
  const r4done = await finished(r4!.id);
  assert.equal(r4done!.status, "succeeded");
  assert.deepEqual(r4done!.steps.map((s) => s.stepId).slice(-1), ["later"]);

  // Join: [a, b] -> j (join) executed only once, after both.
  const join = await workflowsService.create(ctx, {
    name: "Jointure",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [echo("a"), echo("b"), { ...echo("j"), join: true }],
      entry: ["a", "b"],
      next: { a: { ok: ["j"] }, b: { ok: ["j"] } },
    },
  });
  const r5 = await finished((await runsService.start(ctx, join.id))!.id);
  assert.equal(r5!.status, "succeeded");
  const ids = r5!.steps.map((s) => s.stepId);
  assert.deepEqual(
    ids.filter((i) => i === "j"),
    ["j"],
  );
  assert.equal(ids.at(-1), "j");
  await worker.close();
});

test("fn.* step: logs in runs.get; test run labeled", async () => {
  const { functionsService } = await import("../functions");
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("RunsFn");
  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
  });
  await functionsService.save(ctx, {
    name: "say",
    code: `export default () => { console.log("hello from the step"); return { ok: true }; }`,
  });
  const wf = await workflowsService.create(ctx, {
    name: "Fn",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [{ id: "s", type: "fn.say", input: {} }],
      next: {},
    },
  });
  const run = await runsService.start(ctx, wf.id, { test: true });
  assert.equal(run!.isTest, true);
  const done = await until(
    () => runsService.get(ctx, run!.id),
    (r) => r!.status === "succeeded",
  );
  const step = done!.steps[0] as { logs?: { logs: string }[] };
  assert.match(step.logs![0]!.logs, /hello from the step/);
  await worker.close();
});

// E2E: fn.<name> workflow executed by the sandbox service (HTTP,
// SANDBOX_URL) that calls an allowed external API (permissions.domains).
// Skipped offline (example.com unreachable from the test machine).
const online = await fetch("https://example.com", {
  signal: AbortSignal.timeout(5000),
}).then(
  (r) => r.ok,
  () => false,
);
test(
  "step fn.* via the sandbox service: external API allowed, run output",
  { skip: !online && "example.com injoignable (hors ligne)" },
  async () => {
    const { functionsService } = await import("../functions");
    const { createSandboxServer } = await import("../functions/sandbox-server");
    const token = crypto.randomUUID();
    const server = createSandboxServer(token);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    process.env.SANDBOX_URL = `http://127.0.0.1:${port}`;
    process.env.SANDBOX_TOKEN = token;
    const prev = process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
    delete process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
    await runsQueue().obliterate({ force: true });
    const worker = new Worker(RUNS_QUEUE, processStep, { ...queueOptions() });
    try {
      const ctx = await owner("RunsFnNet");
      await functionsService.save(ctx, {
        name: "fetch-example",
        code: `export default async ({ url }) => {
          const res = await fetch(url);
          const html = await res.text();
          let blocked = null;
          try { await fetch("https://api.github.com"); } catch (e) { blocked = e.name; }
          return { status: res.status, title: html.match(/<title>(.*?)<\\/title>/)?.[1], blocked };
        }`,
        permissions: { domains: ["example.com"], secrets: [] },
      });
      const wf = await workflowsService.create(ctx, {
        name: "FnNet",
        definition: {
          trigger: { type: "trigger.manual" },
          steps: [
            {
              id: "s",
              type: "fn.fetch-example",
              input: { url: "https://example.com/" },
            },
          ],
          next: {},
        },
      });
      const run = await runsService.start(ctx, wf.id, { test: true });
      const done = await until(
        () => runsService.get(ctx, run!.id),
        (r) => ["succeeded", "failed"].includes(r!.status),
      );
      const step = done!.steps[0]!;
      assert.equal(done!.status, "succeeded", JSON.stringify(step));
      assert.deepEqual(step.output, {
        status: 200,
        title: "Example Domain",
        blocked: "NotCapable",
      });
    } finally {
      await worker.close();
      server.close();
      delete process.env.SANDBOX_URL;
      delete process.env.SANDBOX_TOKEN;
      if (prev !== undefined)
        process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK = prev;
    }
  },
);
