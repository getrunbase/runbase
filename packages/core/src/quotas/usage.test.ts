// Integration test: workspace_usage counter and atomic quota.
// Requires DATABASE_URL and REDIS_URL (records bus).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import type { TenantContext } from "../tenant";
import { quotasService } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function owner(): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values ('U') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'U', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

const object = (ctx: TenantContext) =>
  objectsService.create(ctx, {
    slug: "t",
    name: "T",
    fields: [{ key: "n", label: "N", type: "text" }],
  });

// Counter = actual number of records in the workspace.
async function check(ctx: TenantContext, expected: number) {
  const [{ n } = { n: -1 }] =
    await sql`select count(*)::int as n from records where workspace_id = ${ctx.workspaceId}`;
  const [u] =
    await sql`select records from workspace_usage where workspace_id = ${ctx.workspaceId}`;
  assert.equal(n, expected);
  assert.equal(u?.records ?? 0, expected);
  assert.equal((await quotasService.get(ctx)).usage.records, expected);
}

test("atomic quota: N parallel inserts, quota N-1", async () => {
  const ctx = await owner();
  const o = await object(ctx);
  const N = 8;
  await quotasService.set(ctx, { records: N - 1 });
  const res = await Promise.allSettled(
    Array.from({ length: N }, (_, i) =>
      recordsService.upsert(ctx, { objectId: o.id, data: { n: String(i) } }),
    ),
  );
  const ko = res.filter((r) => r.status === "rejected");
  assert.equal(ko.length, 1);
  assert.match(
    String((ko[0] as PromiseRejectedResult).reason),
    /Quota reached/,
  );
  await check(ctx, N - 1);
});

test("consistent counter: upsert_batch, delete, restore, purge, merge", async () => {
  const ctx = await owner();
  const o = await object(ctx);
  const out = await recordsService.upsertBatch(
    ctx,
    o.id,
    ["a", "b", "c", "d"].map((n) => ({ data: { n } })),
  );
  await check(ctx, 4);
  const ids = out.map((r) => r.record.id);
  await recordsService.remove(ctx, ids[0]!);
  await check(ctx, 3);
  await recordsService.restore(ctx, ids[0]!);
  await check(ctx, 4);
  await recordsService.remove(ctx, ids[1]!);
  await recordsService.purge(ctx, { ids: [ids[1]!] });
  await check(ctx, 3);
  await recordsService.merge(ctx, ids[0]!, [ids[2]!]);
  await check(ctx, 2);
  // Full quota: restore refused, counter unchanged.
  await quotasService.set(ctx, { records: 2 });
  await recordsService.remove(ctx, ids[3]!);
  await recordsService.upsert(ctx, { objectId: o.id, data: { n: "e" } });
  await assert.rejects(recordsService.restore(ctx, ids[3]!), /Quota reached/);
  await check(ctx, 2);
});

test("records_ws_obj_created_idx index valid and used by the list", async () => {
  const ctx = await owner();
  const o = await object(ctx);
  const [idx] =
    await sql`select indisvalid from pg_index where indexrelid = 'records_ws_obj_created_idx'::regclass`;
  assert.equal(idx!.indisvalid, true);
  const plan = await sql.begin(async (t) => {
    await t`set local enable_seqscan = off`;
    await t`set local enable_bitmapscan = off`;
    // Without this, on a near-empty table the planner may pick another index
    // and sort afterwards: forbidding the sort makes the ordered index the only plan.
    await t`set local enable_sort = off`;
    return t`explain select id from records where workspace_id = ${ctx.workspaceId}
      and object_id = ${o.id} order by created_at limit 50`;
  });
  assert.match(
    plan.map((r) => r["QUERY PLAN"]).join("\n"),
    /records_ws_obj_created_idx/,
  );
});
