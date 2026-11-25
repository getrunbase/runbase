// quota:maxRunDurationMs: caps function timeouts and the execution time of a
// run (waits excluded). Unlimited by default. Integration: DATABASE_URL,
// REDIS_URL and deno.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Worker } from "bullmq";
import { queueOptions } from "../bus";
import { invalidateEntitlements, quotaOf } from "../entitlements";
import { registerExtensions, resetExtensions } from "../extensions";
import { functionsService } from "../functions";
import type { TenantContext } from "../tenant";
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
  return { organizationId: org!.id, workspaceId: ws!.id, actor: { userId: uid } };
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

const capTo = (ms: number, orgId: string) => {
  registerExtensions({
    billing: {
      entitlements: async (o) =>
        o === orgId
          ? { features: null as never, quotas: { "quota:maxRunDurationMs": ms } }
          : null,
      reportUsage: async () => {},
    },
  });
  invalidateEntitlements();
};

test("maxRunDurationMs: unlimited by default", async () => {
  invalidateEntitlements();
  assert.equal(await quotaOf(crypto.randomUUID(), "quota:maxRunDurationMs"), Infinity);
});

test("maxRunDurationMs: caps the function timeout and the run execution time", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("MaxDuration");
  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
    concurrency: 2,
  });
  try {
    await functionsService.save(ctx, {
      name: "slow",
      code: `export default async () => { await new Promise((r) => setTimeout(r, 20000)); return {}; }`,
    });
    await functionsService.save(ctx, {
      name: "quick",
      code: `export default () => ({ ok: true })`,
    });
    const slow = await workflowsService.create(ctx, {
      name: "slow",
      definition: {
        trigger: { type: "trigger.manual" },
        steps: [
          {
            id: "s",
            type: "fn.slow",
            input: {},
            retry: { attempts: 2, backoff: "1s" },
          },
        ],
      },
    });
    const quick = await workflowsService.create(ctx, {
      name: "quick",
      definition: {
        trigger: { type: "trigger.manual" },
        steps: [
          { id: "a", type: "fn.quick", input: {} },
          { id: "b", type: "fn.quick", input: {} },
        ],
        next: { a: { ok: ["b"] } },
      },
    });

    capTo(2000, ctx.organizationId);
    // Slow function killed at the cap (not at its 30 s default), then the
    // retry is refused: the run has no execution time left.
    const t0 = Date.now();
    const r1 = await settle(ctx, (await runsService.start(ctx, slow.id))!.id);
    assert.equal(r1.status, "failed");
    assert.match(r1.error!, /Maximum run duration reached \(2 s\)/);
    assert.ok(Date.now() - t0 < 12_000, "killed at the cap");
    const [row] = await sql`select active_ms from workflow_runs where id = ${r1.id}`;
    assert.ok(row!.active_ms >= 1000, `active_ms ${row!.active_ms}`);

    // Short steps within the cap: the run succeeds, execution time counted.
    const r2 = await settle(ctx, (await runsService.start(ctx, quick.id))!.id);
    assert.equal(r2.status, "succeeded", r2.error ?? "");
    const [row2] = await sql`select active_ms from workflow_runs where id = ${r2.id}`;
    assert.ok(row2!.active_ms > 0);
  } finally {
    resetExtensions();
    invalidateEntitlements();
    await worker.close();
  }
});
