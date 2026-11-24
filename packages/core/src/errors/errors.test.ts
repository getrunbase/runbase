// Integration test: requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Worker } from "bullmq";
import { z } from "zod";
import { apiKeysService } from "../api-keys";
import { blocks, defineBlock } from "../blocks";
import { queueOptions } from "../bus";
import { ingest } from "../ingest";
import { objectsService } from "../objects";
import { processStep, runsQueue, runsService, RUNS_QUEUE } from "../runs";
import type { TenantContext } from "../tenant";
import { workflowsService } from "../workflows";
import { errorsService, recordError } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

let broken = true;
blocks["test.flaky"] = defineBlock({
  type: "test.flaky",
  label: "test.flaky",
  description: "",
  sideEffect: false,
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  branches: ["ok"],
  run: async () => {
    if (broken) throw new Error("service unavailable");
    return { branch: "ok", output: {} };
  },
});

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 200; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timeout");
}

test("invalid ingestion and failed step: listed, replayed, resolved", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const [org] =
    await sql`insert into organizations (name) values ('Err') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'Err', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx: TenantContext = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  const { key } = await apiKeysService.create(ctx, {
    name: "k",
    scopes: ["write"],
    workspaceIds: [ws!.id],
  });

  // Ingestion: invalid body (422) and unknown object (404).
  const req = { apiKey: key, workspaceId: ws!.id as string };
  assert.equal(
    (await ingest({ ...req, objectSlug: "lead", body: { nope: 1 } })).status,
    422,
  );
  const body = { external_id: "L1", data: { name: "Acme" } };
  assert.equal(
    (await ingest({ ...req, objectSlug: "lead", body })).status,
    404,
  );
  const { items: ingestErrors } = await errorsService.list(ctx, {
    source: "ingest",
  });
  assert.equal(ingestErrors.length, 2);
  const unknown = ingestErrors.find((e) => /Unknown object/.test(e.message))!;
  assert.deepEqual((unknown.payload as { body: unknown }).body, body);

  // Replay after creating the object: record written, error resolved.
  await objectsService.create(ctx, {
    slug: "lead",
    name: "Lead",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  // Read-only key: replay refused before any read.
  const ro = await apiKeysService.create(ctx, {
    name: "ro",
    scopes: ["read"],
    workspaceIds: [ws!.id],
  });
  await assert.rejects(
    errorsService.retry(
      { ...ctx, actor: { apiKeyId: ro.id, scopes: ["read"] } },
      unknown.id,
    ),
    /Scope write required/,
  );
  const replay = await errorsService.retry(ctx, unknown.id);
  assert.equal(replay!.ok, true);
  assert.equal((await errorsService.get(ctx, unknown.id))!.status, "resolved");

  // Workflow: step failed after retries.
  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
  });
  const wf = await workflowsService.create(ctx, {
    name: "Flaky",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [{ id: "call", type: "test.flaky", input: {} }],
    },
  });
  const r = await runsService.start(ctx, wf.id);
  await until(
    () => runsService.get(ctx, r!.id),
    (x) => x!.status === "failed",
  );
  const {
    items: [wfError],
  } = await until(
    () => errorsService.list(ctx, { source: "workflow", status: "open" }),
    (l) => l.items.length === 1,
  );
  assert.equal(wfError!.runId, r!.id);
  assert.equal(wfError!.stepId, "call");
  assert.equal(await errorsService.openCount(ctx), 2);

  // Run replay: the step is re-executed and the run completes.
  broken = false;
  assert.equal((await errorsService.retry(ctx, wfError!.id))!.ok, true);
  const done = await until(
    () => runsService.get(ctx, r!.id),
    (x) => x!.status !== "running",
  );
  assert.equal(done!.status, "succeeded");
  assert.deepEqual(
    done!.steps.map((s) => [s.stepId, s.error]),
    [["call", null]],
  );

  await errorsService.resolve(ctx, ingestErrors.find((e) => e !== unknown)!.id);
  assert.equal(await errorsService.openCount(ctx), 0);
  await worker.close();
});

test("errors cleaned and grouped by fingerprint", async () => {
  const [org] =
    await sql`insert into organizations (name) values ('Fp') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'Fp', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx: TenantContext = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  for (const id of [crypto.randomUUID(), crypto.randomUUID()])
    await recordError(ctx, {
      source: "function",
      request: "f",
      message: `\x1B[31merror\x1B[0m: record ${id} missing at file:///tmp/fn-${id.slice(0, 6)}/fn.ts:3:9`,
    });
  await recordError(ctx, { source: "function", message: "other" });
  const all = await errorsService.list(ctx);
  assert.equal(all.items.length, 3);
  for (const e of all.items) {
    assert.ok(!e.message.includes("\x1B"), e.message);
    assert.ok(!e.message.includes("/tmp/fn-"), e.message);
  }
  const grouped = await errorsService.list(ctx, { group: true });
  assert.deepEqual(grouped.items.map((e) => e.count).sort(), [1, 2]);
});
