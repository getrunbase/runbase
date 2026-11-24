// Stable keyset pagination with sort, purge of 100k ids,
// no .offset() in the core. Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { objectsService } from "../objects";
import { type TenantContext } from "../tenant";
import { recordsService } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function owner(name: string): Promise<TenantContext> {
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

test("no .offset( in packages/core/src", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p);
    }
  };
  walk(join(import.meta.dirname, ".."));
  const hits = files.filter((f) =>
    readFileSync(f, "utf8").includes(".offset("),
  );
  assert.deepEqual(hits, []);
});

test("keyset: 3 sorted pages (sort duplicates, nulls, two sorts), no duplicate or gap", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const ctx = await owner("Keyset");
  const obj = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "stage", label: "Stage", type: "text" },
      { key: "amount", label: "Montant", type: "number" },
    ],
  });
  // 12 records: repeated and missing amounts, repeated stages.
  const amounts = [5, 3, null, 5, 1, 3, null, 5, 2, 3, 1, null];
  for (const [i, amount] of amounts.entries())
    await recordsService.upsert(ctx, {
      objectId: obj.id,
      data: { name: `D${i}`, stage: i % 2 ? "won" : "lost", amount },
    });
  for (const sort of [
    [{ field: "amount", dir: "desc" as const }],
    [{ field: "amount" }],
    [{ field: "stage" }, { field: "amount", dir: "desc" as const }],
    [],
  ]) {
    const all = await recordsService.search(ctx, obj.id, {
      sort,
      pagination: { limit: 100 },
    });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let p = 0; p < 3; p++) {
      const res = await recordsService.searchPage(ctx, obj.id, {
        sort,
        pagination: { limit: 4, after: cursor },
      });
      seen.push(...res.records.map((r) => r.id));
      assert.equal(res.hasMore, p < 2, JSON.stringify(sort));
      cursor = res.next ?? undefined;
    }
    assert.deepEqual(
      seen,
      all.map((r) => r.id),
      JSON.stringify(sort),
    );
  }
  // Trash paginated with keyset.
  const ids = (
    await recordsService.search(ctx, obj.id, { pagination: { limit: 100 } })
  ).map((r) => r.id);
  for (const id of ids.slice(0, 5)) await recordsService.remove(ctx, id);
  const p1 = await recordsService.trash(ctx, obj.id, { limit: 3 });
  const p2 = await recordsService.trash(ctx, obj.id, {
    limit: 3,
    after: p1.at(-1)!.id,
  });
  assert.equal(p1.length + p2.length, 5);
  assert.equal(new Set([...p1, ...p2].map((r) => r.id)).size, 5);
});

test("purge of 100k ids in the trash", async () => {
  const ctx = await owner("Purge100k");
  const obj = await objectsService.create(ctx, {
    slug: "row",
    name: "Row",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  await sql`insert into deleted_records
    (id, organization_id, workspace_id, object_id, data, created_at, updated_at)
    select gen_random_uuid(), ${ctx.organizationId}, ${ctx.workspaceId}, ${obj.id},
      '{}'::jsonb, now(), now() from generate_series(1, 100000)`;
  const ids = (
    await sql<
      { id: string }[]
    >`select id from deleted_records where workspace_id = ${ctx.workspaceId}`
  ).map((r) => r.id);
  assert.equal(ids.length, 100_000);
  const res = await recordsService.purge(ctx, { ids });
  assert.equal(res.purged, 100_000);
  const [left] =
    await sql`select count(*)::int as n from deleted_records where workspace_id = ${ctx.workspaceId}`;
  assert.equal(left!.n, 0);
});
