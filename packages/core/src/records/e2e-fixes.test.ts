// Integration test (E2E regressions): requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { workflowsService } from "../workflows";
import { recordsService } from "./index";

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

test("e2e: data.x filter, system sort, sum on currency, non-uuid id", async () => {
  const ctx = await owner("E2E fixes");
  const o = await objectsService.create(ctx, {
    slug: "deals",
    name: "Deals",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "thread", label: "Thread", type: "text" },
      { key: "amount", label: "Amount", type: "currency" },
    ],
  });
  for (const [name, thread, amount] of [
    ["a", "t1", 10],
    ["b", "t1", 5],
    ["c", "t2", 1],
  ] as const)
    await recordsService.upsert(ctx, {
      objectId: o.id,
      data: { name, thread, amount },
    });

  // `data.` prefix tolerated in a filter (unibox / recordView recipes).
  const t1 = await recordsService.search(ctx, o.id, {
    filter: { field: "data.thread", op: "eq", value: "t1" },
  });
  assert.equal(t1.length, 2);

  // System columns created_at / updated_at sortable without a schema field.
  const asc = await recordsService.search(ctx, o.id, {
    sort: [{ field: "created_at", dir: "asc" }],
  });
  assert.deepEqual(
    asc.map((r) => (r.data as { name: string }).name),
    ["a", "b", "c"],
  );
  const up = await recordsService.search(ctx, o.id, {
    sort: [{ field: "updated_at", dir: "desc" }],
  });
  assert.equal((up[0]!.data as { name: string }).name, "c");

  // sum on a currency field.
  const [agg] = await recordsService.aggregate(ctx, o.id, {
    aggregate: [{ op: "sum", field: "amount", as: "total" }],
  });
  assert.equal(Number((agg as { total: unknown }).total), 16);

  // Non-uuid id: not found, no raw SQL error.
  assert.equal(await workflowsService.activate(ctx, "null"), null);
});
