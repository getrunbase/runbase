// Integration test: monthly run counter and quota:runsPerMonth.
// Requires DATABASE_URL and REDIS_URL.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { runsService } from "../runs";
import type { TenantContext } from "../tenant";
import { workflowsService } from "../workflows";
import { countRun, currentMonth, quotasService, runsThisMonth } from "./index";
import { invalidateEntitlements } from "../entitlements";
import { registerExtensions, resetExtensions } from "../extensions";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));
afterEach(() => {
  resetExtensions();
  invalidateEntitlements();
});

async function owner(): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values ('M') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'M', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return { organizationId: org!.id, workspaceId: ws!.id, actor: { userId: uid } };
}

const cap = (ctx: TenantContext, n: number) => {
  registerExtensions({
    billing: {
      entitlements: async (org) =>
        org === ctx.organizationId
          ? { features: [], quotas: { "quota:runsPerMonth": n } }
          : null,
      reportUsage: async () => {},
    },
  });
  invalidateEntitlements();
};

test("currentMonth: first day of the UTC month", () => {
  assert.equal(currentMonth(new Date("2026-11-30T23:59:59Z")), "2026-11-01");
  assert.equal(currentMonth(new Date("2027-01-01T00:00:00Z")), "2027-01-01");
});

test("unlimited by default: runs counted, never refused", async () => {
  const ctx = await owner();
  for (let i = 0; i < 3; i++) await countRun(ctx);
  assert.equal(await runsThisMonth(ctx.organizationId), 3);
  assert.equal((await quotasService.get(ctx)).usage.runsThisMonth, 3);
});

test("counter resets on a new month", async () => {
  const ctx = await owner();
  await countRun(ctx);
  await sql`update workspace_usage set runs = 99, runs_month = '2000-01-01' where workspace_id = ${ctx.workspaceId}`;
  assert.equal(await runsThisMonth(ctx.organizationId), 0);
  await countRun(ctx);
  assert.equal(await runsThisMonth(ctx.organizationId), 1);
});

test("quota:runsPerMonth caps the organization, all workspaces summed", async () => {
  const ctx = await owner();
  const [ws2] =
    await sql`insert into workspaces (organization_id, name) values (${ctx.organizationId}, 'Second') returning id`;
  const ctx2 = { ...ctx, workspaceId: ws2!.id as string };
  cap(ctx, 2);
  await countRun(ctx);
  await countRun(ctx2);
  await assert.rejects(countRun(ctx), {
    status: 429,
    code: "quotas.runsPerMonth",
    message: /2 runs per month/,
  });
  assert.equal(await runsThisMonth(ctx.organizationId), 2);
});

test("runsService.start counts the run and refuses beyond the quota", async () => {
  const ctx = await owner();
  cap(ctx, 1);
  const wf = await workflowsService.create(ctx, {
    name: "W",
    definition: { trigger: { type: "trigger.manual" }, steps: [] },
  });
  await runsService.start(ctx, wf.id);
  await assert.rejects(runsService.start(ctx, wf.id), {
    code: "quotas.runsPerMonth",
  });
  assert.equal(await runsThisMonth(ctx.organizationId), 1);
});
