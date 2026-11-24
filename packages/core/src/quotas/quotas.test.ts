// Integration test: requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { runsService } from "../runs";
import type { TenantContext } from "../tenant";
import { workflowsService } from "../workflows";
import { quotasService, rateLimit } from "./index";
import { can, invalidateEntitlements } from "../entitlements";
import { registerExtensions, resetExtensions } from "../extensions";
import { workspacesService } from "../workspaces";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function owner(): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values ('Q') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'Q', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

test("records quota: clear refusal beyond, batches included", async () => {
  const ctx = await owner();
  const o = await objectsService.create(ctx, {
    slug: "t",
    name: "T",
    fields: [{ key: "n", label: "N", type: "text" }],
  });
  const q = await quotasService.set(ctx, { records: 2 });
  assert.equal(q.limits.records, 2);
  await recordsService.upsert(ctx, { objectId: o.id, data: { n: "1" } });
  await recordsService.upsert(ctx, { objectId: o.id, data: { n: "2" } });
  await assert.rejects(
    recordsService.upsert(ctx, { objectId: o.id, data: { n: "3" } }),
    { status: 429, message: /Quota reached: 2 records maximum/ },
  );
  assert.equal((await quotasService.get(ctx)).usage.records, 2);
  // Back to default: writing possible again.
  await quotasService.set(ctx, {});
  await recordsService.upsert(ctx, { objectId: o.id, data: { n: "3" } });
});

test("entitlements: extension caps enforced, effective = min(pref, cap)", async () => {
  const ctx = await owner();
  registerExtensions({
    billing: {
      entitlements: async (org) =>
        org === ctx.organizationId
          ? {
              features: [],
              quotas: {
                "quota:records": 50,
                "quota:runsPerMinute": 5,
                "quota:apiPerMinute": 10,
                "quota:aiBudgetUsd": 20,
                "quota:workspaces": 1,
              },
            }
          : null,
      reportUsage: async () => {},
    },
  });
  invalidateEntitlements();
  try {
    await assert.rejects(quotasService.set(ctx, { records: 51 }), {
      code: "quotas.exceedsLimit",
    });
    await assert.rejects(runsService.setBudget(ctx, 21), {
      code: "quotas.exceedsLimit",
    });
    const q = await quotasService.set(ctx, { records: 40 });
    assert.equal(q.limits.records, 40);
    // Default (100,000) above the cap: the cap wins.
    assert.equal(q.limits.runsPerMinute, 5);
    assert.equal(q.limits.apiPerMinute, 10);
    // Preference written before a lower cap: bounded on read.
    await sql`update workspaces set limits = '{"records": 1000}' where id = ${ctx.workspaceId}`;
    assert.equal((await quotasService.get(ctx)).limits.records, 50);
    const b = await runsService.setBudget(ctx, null);
    assert.equal(b.budgetUsd, 20);
    // A single workspace allowed: the second one is refused (translated error).
    await assert.rejects(workspacesService.create(ctx, "Second"), {
      code: "quotas.limit",
    });
    assert.equal(await can(ctx, "feat:sso"), false);
  } finally {
    resetExtensions();
    invalidateEntitlements();
  }
});

test("entitlements: without extension nothing is capped", async () => {
  const ctx = await owner();
  invalidateEntitlements();
  const q = await quotasService.get(ctx);
  assert.deepEqual(q.caps, { records: null, runsPerMinute: null, apiPerMinute: null });
  assert.equal((await runsService.setBudget(ctx, 1e6)).budgetUsd, 1e6);
  assert.equal(await can(ctx, "feat:anything"), true);
  await workspacesService.create(ctx, "Second");
});

test("rateLimit: limits cached, invalidated by quotas.set", async () => {
  const ctx = await owner();
  await quotasService.set(ctx, { apiPerMinute: 100 });
  await rateLimit(ctx, "api");
  // Direct write in the database: ignored while the cache is valid (no
  // DB reread per call).
  await sql`update workspaces set limits = '{"apiPerMinute": 1}' where id = ${ctx.workspaceId}`;
  await rateLimit(ctx, "api");
  await rateLimit(ctx, "api");
  // quotas.set invalidates the cache: the new limit applies immediately.
  await quotasService.set(ctx, { apiPerMinute: 3 });
  await assert.rejects(rateLimit(ctx, "api"), /3 API calls per minute/);
});

test("per-minute limits: runs and API calls", async () => {
  const ctx = await owner();
  await quotasService.set(ctx, { runsPerMinute: 1, apiPerMinute: 2 });
  const wf = await workflowsService.create(ctx, {
    name: "W",
    definition: { trigger: { type: "trigger.manual" }, steps: [] },
  });
  await runsService.start(ctx, wf.id);
  await assert.rejects(runsService.start(ctx, wf.id), {
    status: 429,
    message: /1 workflow runs per minute/,
  });
  await rateLimit(ctx, "api");
  await rateLimit(ctx, "api");
  await assert.rejects(rateLimit(ctx, "api"), /2 API calls per minute/);
});
