// Integration test: number of SQL queries sent (client
// hook) by withTenant, layout loading and the bus dispatch.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { sql as q } from "drizzle-orm";
import { onQuery } from "../db/client";
import { loadNavData } from "../nav";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { resolve } from "../triggers";
import { workflowsService } from "../workflows";
import {
  resolveUserSession,
  resolveUserSessionCached,
  withTenant,
  type TenantContext,
} from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function tenant(name: string): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, ${name}) returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, ${name}, ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

// Queries sent during fn, excluding transaction begin/commit/rollback.
async function count<T>(fn: () => Promise<T>) {
  const seen: string[] = [];
  const off = onQuery((q) => {
    if (!/^\s*(begin|commit|rollback)\b/i.test(q)) seen.push(q);
  });
  try {
    return { result: await fn(), n: seen.length, seen };
  } finally {
    off();
  }
}

test("withTenant: a single round trip, access always checked", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await tenant("Q-A");
  const b = await tenant("Q-B");
  const { n } = await count(() => withTenant(a, async () => 1));
  assert.equal(n, 1);
  // Role and variables set by that same round trip.
  const [r] = await withTenant(a, (tx) =>
    tx.execute<{ role: string; org: string }>(
      q`select current_user as role,
        current_setting('app.org_id') as org`,
    ),
  );
  assert.deepEqual(r, { role: "app_tenant", org: a.organizationId });
  await assert.rejects(
    withTenant({ ...b, actor: a.actor }, async () => 1),
    /Access denied/,
  );
  await assert.rejects(
    withTenant({ ...a, workspaceId: b.workspaceId }, async () => 1),
    /Access denied/,
  );
});

test("layout: context in one query (then cached), navigation in one transaction", async () => {
  const a = await tenant("Q-Layout");
  const uid = (a.actor as { userId: string }).userId;
  await objectsService.create(a, {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const s = await count(() => resolveUserSessionCached(uid, a.workspaceId));
  assert.equal(s.n, 1);
  assert.equal(s.result!.role, "owner");
  assert.deepEqual(s.result!.workspaces, [
    { id: a.workspaceId, name: "Q-Layout" },
  ]);
  assert.equal(
    (await count(() => resolveUserSessionCached(uid, a.workspaceId))).n,
    0,
  );

  const nav = await count(() => loadNavData(a, "owner"));
  // set_config + navigation query; with the better-auth session, the
  // layout stays ≤ 4 queries.
  assert.equal(nav.n, 2);
  assert.deepEqual(
    nav.result.objects.map((o) => o.slug),
    ["deal"],
  );
  assert.equal(nav.result.openErrors, 0);
  assert.deepEqual(
    await resolveUserSession(uid, crypto.randomUUID()),
    s.result,
  );
});

test("bus: dispatch with a constant number of queries (no N+1)", async () => {
  const ctx = await tenant("Q-Bus");
  const obj = await objectsService.create(ctx, {
    slug: "lead",
    name: "Lead",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  await objectsService.create(ctx, {
    slug: "other",
    name: "Other",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "Acme" },
  });
  // Active workflows on another object: no run, only the dispatch counts.
  const addWorkflows = async (n: number) => {
    for (let i = 0; i < n; i++) {
      const wf = await workflowsService.create(ctx, {
        name: `W${crypto.randomUUID()}`,
        definition: {
          trigger: { type: "trigger.record_updated", object: "other" },
          steps: [],
        },
      });
      await workflowsService.update(ctx, wf.id, { status: "active" });
    }
  };
  const dispatch = () =>
    count(() =>
      resolve({
        name: "record.updated",
        data: { ...ctx, id: record.id, changed: ["name"] },
      }),
    );
  await addWorkflows(1);
  const one = await dispatch();
  await addWorkflows(5);
  const six = await dispatch();
  assert.deepEqual(one.result, []);
  assert.deepEqual(six.result, []);
  assert.equal(six.n, one.n, six.seen.join("\n---\n"));
});
