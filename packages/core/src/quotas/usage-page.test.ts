// Settings › Usage: meters against effective limits, with or without a
// billing extension. Requires DATABASE_URL and REDIS_URL.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { invalidateEntitlements } from "../entitlements";
import { registerExtensions, resetExtensions } from "../extensions";
import type { TenantContext } from "../tenant";
import { monthStart, usageService } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));
afterEach(() => {
  resetExtensions();
  invalidateEntitlements();
});

async function seed(): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values ('usage test') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'w') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'U', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const [d] =
    await sql`insert into databases (organization_id, workspace_id, slug, name) values (${org!.id}, ${ws!.id}, 'd', 'D') returning id`;
  const [o] =
    await sql`insert into objects (organization_id, workspace_id, database_id, slug, name) values (${org!.id}, ${ws!.id}, ${d!.id}, 'o', 'O') returning id`;
  const file = { key: "k/1", name: "a.pdf", size: 1500, type: "application/pdf" };
  await sql`insert into records (organization_id, workspace_id, object_id, data) values
    (${org!.id}, ${ws!.id}, ${o!.id}, ${sql.json({ doc: file, files: [{ ...file, size: 500 }] })}),
    (${org!.id}, ${ws!.id}, ${o!.id}, ${sql.json({ name: "no file", size: 9 })})`;
  const [wf] =
    await sql`insert into workflows (organization_id, workspace_id, name) values (${org!.id}, ${ws!.id}, 'wf') returning id`;
  const lastMonth = new Date(monthStart().getTime() - 1000);
  for (const at of [new Date(), new Date(), lastMonth])
    await sql`insert into workflow_runs (organization_id, workspace_id, workflow_id, version, actor, input, created_at)
      values (${org!.id}, ${ws!.id}, ${wf!.id}, 1, ${sql.json({})}, ${sql.json({})}, ${at})`;
  return { organizationId: org!.id, workspaceId: ws!.id, actor: { userId: uid } };
}

const byKey = (m: Awaited<ReturnType<typeof usageService.get>>) =>
  Object.fromEntries(m.map((x) => [x.key, x]));

test("self-host without extension: usage shown, plan caps unlimited", async () => {
  const m = byKey(await usageService.get(await seed()));
  assert.equal(m.records!.used, 2);
  assert.equal(typeof m.records!.limit, "number");
  assert.deepEqual(m.runsPerMonth, { key: "runsPerMonth", used: 2, limit: null });
  assert.deepEqual(m.storageBytes, { key: "storageBytes", used: 2000, limit: null });
  assert.deepEqual(m.workspaces, { key: "workspaces", used: 1, limit: null });
  assert.equal(m.apiPerMinute!.used, 0);
});

test("extension caps become the limits", async () => {
  registerExtensions({
    billing: {
      entitlements: async () => ({
        features: [],
        quotas: {
          "quota:records": 10,
          "quota:runsPerMonth": 100,
          "quota:storageBytes": 4000,
          "quota:workspaces": 3,
          "quota:apiPerMinute": 50,
        },
      }),
      reportUsage: async () => {},
    },
  });
  const m = byKey(await usageService.get(await seed()));
  assert.equal(m.records!.limit, 10);
  assert.equal(m.runsPerMonth!.limit, 100);
  assert.equal(m.storageBytes!.limit, 4000);
  assert.equal(m.workspaces!.limit, 3);
  assert.equal(m.apiPerMinute!.limit, 50);
});

test("monthStart is the first day of the month, UTC", () => {
  assert.equal(
    monthStart(new Date("2026-03-17T10:00:00Z")).toISOString(),
    "2026-03-01T00:00:00.000Z",
  );
});
