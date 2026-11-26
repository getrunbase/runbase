// Settings › Usage: meters against effective limits, with or without a
// billing extension. Requires DATABASE_URL and REDIS_URL.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { invalidateEntitlements } from "../entitlements";
import { registerExtensions, resetExtensions } from "../extensions";
import type { TenantContext } from "../tenant";
import { currentMonth, monthStart, usageService } from "./index";

const aiMonth = () => new Date().toISOString().slice(0, 7);

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
  await sql`insert into records (organization_id, workspace_id, object_id, data) values
    (${org!.id}, ${ws!.id}, ${o!.id}, ${sql.json({ name: "a" })}),
    (${org!.id}, ${ws!.id}, ${o!.id}, ${sql.json({ name: "b" })})`;
  // Counters the quota checks enforce: runs this month, stored bytes.
  await sql`insert into workspace_usage (workspace_id, organization_id, runs, runs_month, storage_bytes)
    values (${ws!.id}, ${org!.id}, 2, ${currentMonth()}, 2000)
    on conflict (workspace_id) do update set runs = 2, runs_month = excluded.runs_month, storage_bytes = 2000`;
  // A second workspace: last month's runs do not count, its bytes do.
  const [ws2] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'w2') returning id`;
  await sql`insert into workspace_usage (workspace_id, organization_id, runs, runs_month, storage_bytes)
    values (${ws2!.id}, ${org!.id}, 7, '2000-01-01', 500)`;
  // Pages: one published, one draft, one published in the other workspace.
  await sql`insert into pages (organization_id, workspace_id, name, files, current_version) values
    (${org!.id}, ${ws!.id}, 'P1', '{}', 1),
    (${org!.id}, ${ws!.id}, 'P2', '{}', null),
    (${org!.id}, ${ws2!.id}, 'P3', '{}', 2)`;
  await sql`update workspaces set ai_spent_usd = 1.5, ai_spent_month = ${aiMonth()}, ai_budget_usd = 10
    where id = ${ws!.id}`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

const byKey = (m: Awaited<ReturnType<typeof usageService.get>>) =>
  Object.fromEntries(m.map((x) => [x.key, x]));

test("self-host without extension: usage shown, plan caps unlimited", async () => {
  const m = byKey(await usageService.get(await seed()));
  assert.equal(m.records!.used, 2);
  assert.equal(typeof m.records!.limit, "number");
  assert.equal(m.records!.scope, "workspace");
  const org = (key: string, used: number) => ({
    key,
    scope: "organization",
    used,
    limit: null,
  });
  assert.deepEqual(m.runsPerMonth, org("runsPerMonth", 2));
  assert.deepEqual(m.storageBytes, org("storageBytes", 2500));
  assert.deepEqual(m.workspaces, org("workspaces", 2));
  assert.deepEqual(m.pages, org("pages", 2));
  assert.deepEqual(m.aiBudgetUsd, {
    key: "aiBudgetUsd",
    scope: "workspace",
    used: 1.5,
    limit: 10,
  });
  assert.equal(m.apiPerMinute!.used, 0);
  assert.equal(m.runsPerMinute!.used, 0);
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
          "quota:runsPerMinute": 20,
          "quota:pages": 5,
          "quota:aiBudgetUsd": 4,
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
  assert.equal(m.runsPerMinute!.limit, 20);
  assert.equal(m.pages!.limit, 5);
  // Workspace preference (10) capped by the entitlement (4).
  assert.equal(m.aiBudgetUsd!.limit, 4);
});

test("monthStart is the first day of the month, UTC", () => {
  assert.equal(
    monthStart(new Date("2026-03-17T10:00:00Z")).toISOString(),
    "2026-03-01T00:00:00.000Z",
  );
});
