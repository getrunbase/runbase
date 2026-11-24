// Integration test (data-power batch): requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { type TenantContext } from "../tenant";
import {
  MAX_INDEXES_PER_WORKSPACE,
  objectsService,
  recordIndexName,
} from "../objects";
import { recordsService } from "./index";
import { viewsService } from "../views";
import { filesService, memoryStorage, setFileStorage } from "../files";

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

test("computed fields: formula, autonumber, timestamps, default, lookup and rollup", async () => {
  const ctx = await owner("power-calc");
  const company = await objectsService.create(ctx, {
    slug: "company",
    name: "Companies",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "country", label: "Country", type: "text", default: "FR" },
    ],
  });
  const deal = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deals",
    fields: [
      { key: "num", label: "N°", type: "autonumber" },
      { key: "amount", label: "Montant", type: "currency", min: 0 },
      { key: "qty", label: "Qty", type: "number", default: 1 },
      {
        key: "total",
        label: "Total",
        type: "formula",
        formula: "amount * qty",
        result: "number",
      },
      { key: "company", label: "Company", type: "ref", object: "company" },
      {
        key: "country",
        label: "Country",
        type: "lookup",
        through: "company",
        field: "country",
      },
      { key: "created", label: "Created", type: "created_at" },
      { key: "updated", label: "Updated", type: "updated_at" },
      { key: "by", label: "Par", type: "created_by" },
    ],
  });
  await objectsService.update(ctx, company.id, {
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "country", label: "Country", type: "text", default: "FR" },
      {
        key: "deals",
        label: "Deals",
        type: "rollup",
        through: "deal",
        op: "count",
      },
      {
        key: "sum",
        label: "CA",
        type: "rollup",
        through: "deal",
        field: "total",
        op: "sum",
      },
    ],
  });
  const { record: acme } = await recordsService.upsert(ctx, {
    objectId: company.id,
    data: { name: "Acme" },
  });
  assert.equal(acme.data.country, "FR");
  const { record: d1 } = await recordsService.upsert(ctx, {
    objectId: deal.id,
    data: { amount: 10, qty: 3, company: acme.id, total: 1, num: 99 },
  });
  const { record: d2 } = await recordsService.upsert(ctx, {
    objectId: deal.id,
    data: { amount: 5, company: acme.id },
  });
  assert.equal(d1.data.total, 30);
  assert.equal(d1.data.num, 1);
  assert.equal(d2.data.num, 2);
  assert.equal(d2.data.total, 5);
  assert.equal(d1.data.by, (ctx.actor as { userId: string }).userId);
  assert.ok(d1.data.created);
  await assert.rejects(
    recordsService.upsert(ctx, { objectId: deal.id, data: { amount: -1 } }),
  );
  const { record: u } = await recordsService.update(ctx, d1.id, { qty: 4 });
  assert.equal(u.data.total, 40);
  assert.equal(u.data.created, d1.data.created);
  const got = await recordsService.get(ctx, d1.id);
  assert.equal(got.data.country, "FR");
  const [c] = await recordsService.search(ctx, company.id);
  assert.equal(c!.data.deals, 2);
  assert.equal(c!.data.sum, 45);
  // Rewritten formula: applied to existing records.
  const dealFields = (await objectsService.get(ctx, deal.id))!.fields as {
    key: string;
  }[];
  await objectsService.update(ctx, deal.id, {
    fields: dealFields.map((f) =>
      f.key === "total" ? { ...f, formula: "amount * qty * 2" } : f,
    ) as never,
  });
  assert.equal((await recordsService.get(ctx, d2.id)).data.total, 10);
});

test("search: hasMore/total, after with sort, not_in/ends_with/regex, index, views", async () => {
  const ctx = await owner("power-search");
  const o = await objectsService.create(ctx, {
    slug: "item",
    name: "Items",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "rank", label: "Rank", type: "number" },
    ],
  });
  const names = ["alpha", "beta", "gamma", "delta", "epsilon"];
  for (const [i, name] of names.entries())
    await recordsService.upsert(ctx, {
      objectId: o.id,
      data: i === 4 ? { name } : { name, rank: i % 2 },
    });
  const p1 = await recordsService.searchPage(ctx, o.id, {
    sort: [{ field: "rank", dir: "asc" }],
    pagination: { limit: 2 },
  });
  assert.equal(p1.total, 5);
  assert.equal(p1.hasMore, true);
  const seen = p1.records.map((r) => r.data.name);
  let next = p1.next;
  while (next) {
    const p = await recordsService.searchPage(ctx, o.id, {
      sort: [{ field: "rank", dir: "asc" }],
      pagination: { limit: 2, after: next },
    });
    seen.push(...p.records.map((r) => r.data.name));
    next = p.next;
  }
  assert.deepEqual([...seen].sort(), [...names].sort());
  assert.equal(seen.at(-1), "epsilon"); // nulls last
  const hit = async (filter: object) =>
    (await recordsService.search(ctx, o.id, { filter: filter as never }))
      .map((r) => r.data.name)
      .sort();
  assert.deepEqual(await hit({ field: "name", op: "ends_with", value: "TA" }), [
    "beta",
    "delta",
  ]);
  assert.deepEqual(await hit({ field: "name", op: "regex", value: "^(a|g)" }), [
    "alpha",
    "gamma",
  ]);
  assert.deepEqual(await hit({ field: "rank", op: "not_in", value: [0] }), [
    "beta",
    "delta",
    "epsilon",
  ]);

  const { index } = await objectsService.index(ctx, o.id, "rank");
  const [idx] =
    await sql`select indexdef from pg_indexes where indexname = ${index}`;
  assert.match(idx!.indexdef, /numeric/);
  await objectsService.index(ctx, o.id, "rank"); // idempotent

  await viewsService.save(ctx, o.id, {
    name: "Rank 1",
    filter: { field: "rank", op: "eq", value: 1 },
    sort: [{ field: "name", dir: "desc" }],
    columns: ["name"],
  });
  await assert.rejects(
    viewsService.save(ctx, o.id, { name: "x", columns: ["nope"] }),
  );
  assert.equal((await viewsService.list(ctx, o.id)).length, 1);
  await viewsService.remove(ctx, o.id, "Rank 1");
  assert.equal((await viewsService.list(ctx, o.id)).length, 0);
});

test("files: upload, reads limited to the workspace, file field validated", async () => {
  setFileStorage(memoryStorage());
  const ctx = await owner("power-files");
  const other = await owner("power-files-2");
  const meta = await filesService.upload(ctx, {
    name: "quote.txt",
    type: "text/plain",
    base64: Buffer.from("hello").toString("base64"),
  });
  assert.equal(meta.size, 5);
  const f = await filesService.download(ctx, meta.key);
  assert.equal(Buffer.from(f.bytes).toString(), "hello");
  await assert.rejects(filesService.download(other, meta.key));
  // A `..` does not allow climbing to another workspace.
  await assert.rejects(
    filesService.download(other, `${other.workspaceId}/../${meta.key}`),
  );
  const o = await objectsService.create(ctx, {
    slug: "doc",
    name: "Docs",
    fields: [{ key: "pj", label: "Attachments", type: "file" }],
  });
  await recordsService.upsert(ctx, { objectId: o.id, data: { pj: [meta] } });
  await assert.rejects(
    recordsService.upsert(ctx, { objectId: o.id, data: { pj: "x" } }),
  );
});

test("field indexes: hashed names, quota per workspace", async () => {
  assert.equal(recordIndexName("a", "b"), recordIndexName("a", "b"));
  assert.notEqual(
    recordIndexName("a", "long_key_1"),
    recordIndexName("a", "long_key_2"),
  );
  assert.ok(recordIndexName("a", "x".repeat(60)).length <= 63);

  const ctx = await owner("power-index");
  const keys = Array.from(
    { length: MAX_INDEXES_PER_WORKSPACE + 1 },
    (_, i) => `f${i}`,
  );
  const o = await objectsService.create(ctx, {
    slug: "idx",
    name: "Idx",
    fields: keys.map((key) => ({ key, label: key, type: "text" as const })),
  });
  for (const key of keys.slice(0, MAX_INDEXES_PER_WORKSPACE))
    await objectsService.index(ctx, o.id, key);
  // Already existing: still accepted (idempotent).
  await objectsService.index(ctx, o.id, "f0");
  await assert.rejects(objectsService.index(ctx, o.id, keys.at(-1)!), {
    code: "objects.indexQuota",
    kind: "quota_exceeded",
  });
  // Another workspace has its own quota.
  const other = await owner("power-index-2");
  const o2 = await objectsService.create(other, {
    slug: "idx",
    name: "Idx",
    fields: [{ key: "f0", label: "f0", type: "text" }],
  });
  const { index } = await objectsService.index(other, o2.id, "f0");
  assert.equal(index, recordIndexName(o2.id, "f0"));
});
