// Export, schema evolution and confirmed deletion (integration,
// requires DATABASE_URL).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { type TenantContext } from "../tenant";
import { recordsService } from "../records";
import { parseCsv } from "../records/csv";
import { convertValue, exportStream, objectsService } from "./index";

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

test("convertValue : conversions common", () => {
  const f = (type: string, extra = {}) =>
    ({ key: "k", label: "K", type, ...extra }) as never;
  assert.equal(convertValue("12,5", f("number")), 12.5);
  assert.equal(convertValue("abc", f("number")), "abc");
  assert.equal(convertValue("yes", f("bool")), true);
  assert.equal(convertValue(3, f("text")), "3");
  assert.deepEqual(
    convertValue("a; b", f("multi_select", { options: ["a"] })),
    ["a", "b"],
  );
  assert.equal(convertValue("", f("number")), null);
});

test("export: CSV and JSON paginated beyond 1000 records, full stream", async () => {
  const ctx = await owner("Export");
  const obj = await objectsService.create(ctx, {
    slug: "items",
    name: "Items",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "tags", label: "Tags", type: "multi_select", options: ["a", "b"] },
    ],
  });
  await recordsService.upsertBatch(
    ctx,
    obj.id,
    Array.from({ length: 1005 }, (_, i) => ({
      data: { name: `n${i}, "x"`, tags: ["a"] },
    })),
  );
  const p1 = await objectsService.export(ctx, obj.id);
  assert.ok("csv" in p1);
  assert.ok(p1.next);
  const p2 = await objectsService.export(ctx, obj.id, { after: p1.next! });
  assert.ok("csv" in p2);
  assert.equal(p2.next, null);
  const rows = parseCsv(p1.csv! + p2.csv!);
  assert.deepEqual(rows[0], [
    "id",
    "external_id",
    "name",
    "tags",
    "created_at",
    "updated_at",
  ]);
  assert.equal(rows.length, 1006);
  assert.equal(rows[1]![3], '["a"]');
  assert.match(rows[1]![2]!, /^n\d+, "x"$/);

  let json = "";
  for await (const chunk of exportStream(ctx, obj.id, "json")) json += chunk;
  const parsed = JSON.parse(json) as { id: string }[];
  assert.equal(parsed.length, 1005);
  assert.equal(new Set(parsed.map((r) => r.id)).size, 1005);
});

test("migrate: rename, change_type with report, add/require with default, delete", async () => {
  const ctx = await owner("Migrate");
  const obj = await objectsService.create(ctx, {
    slug: "deals",
    name: "Deals",
    fields: [
      { key: "nom", label: "Name", type: "text", unique: true },
      { key: "amount", label: "Montant", type: "text" },
    ],
  });
  await recordsService.upsertBatch(ctx, obj.id, [
    { data: { nom: "A", amount: "10" } },
    { data: { nom: "B", amount: "twelve" } },
    { data: { nom: "C" } },
  ]);
  const data = async () =>
    (await recordsService.search(ctx, obj.id)).map((r) => r.data);

  // rename: data copied, unique key followed.
  await objectsService.migrate(ctx, obj.id, {
    op: "rename",
    field: "nom",
    to: "name",
  });
  assert.ok((await data()).every((d) => "name" in d && !("nom" in d)));
  await assert.rejects(
    recordsService.upsert(ctx, { objectId: obj.id, data: { name: "A" } }),
    /already in use/,
  );

  // change_type: preview, refusal with invalid values, then dropInvalid.
  const op = {
    op: "change_type" as const,
    field: "amount",
    type: "number" as const,
  };
  const preview = await objectsService.migrate(ctx, obj.id, op, {
    dryRun: true,
  });
  assert.equal(preview.records, 3);
  assert.equal(preview.touched, 2);
  assert.equal(preview.invalid, 1);
  assert.equal(preview.samples[0]!.value, "twelve");
  await assert.rejects(objectsService.migrate(ctx, obj.id, op), /invalid/);
  await objectsService.migrate(ctx, obj.id, { ...op, dropInvalid: true });
  const amounts = (await data()).map((d) => d.amount).filter((x) => x != null);
  assert.deepEqual(amounts, [10]);

  // add required without default: refused; with default: written everywhere.
  const stage = {
    key: "stage",
    label: "Stage",
    type: "select" as const,
    options: ["open", "won"],
    required: true,
  };
  await assert.rejects(
    objectsService.migrate(ctx, obj.id, { op: "add", field: stage }),
    /default value/,
  );
  await assert.rejects(
    objectsService.migrate(ctx, obj.id, {
      op: "add",
      field: stage,
      default: "zz",
    }),
    /Invalid default value/,
  );
  await objectsService.migrate(ctx, obj.id, {
    op: "add",
    field: stage,
    default: "open",
  });
  assert.ok((await data()).every((d) => d.stage === "open"));

  // require: default for empty ones.
  await objectsService.migrate(ctx, obj.id, {
    op: "require",
    field: "amount",
    default: 0,
  });
  assert.deepEqual((await data()).map((d) => d.amount).sort(), [0, 0, 10]);

  // delete: field purged from records and schema.
  await objectsService.migrate(ctx, obj.id, { op: "delete", field: "amount" });
  assert.ok((await data()).every((d) => !("amount" in d)));
  const fields = (await objectsService.get(ctx, obj.id))!.fields as {
    key: string;
  }[];
  assert.deepEqual(
    fields.map((f) => f.key),
    ["name", "stage"],
  );
});

test("migrate: formula add counts touched, change_type map, update op, update_schema guard", async () => {
  const ctx = await owner("Migrate2");
  const obj = await objectsService.create(ctx, {
    slug: "deals",
    name: "Deals",
    fields: [
      { key: "price", label: "Price", type: "number" },
      { key: "stage", label: "Stage", type: "text" },
    ],
  });
  await recordsService.upsertBatch(ctx, obj.id, [
    { data: { price: 10, stage: "Won" } },
    { data: { price: 20, stage: "LOST" } },
    { data: { price: 30, stage: "gagné" } },
  ]);
  const data = async () =>
    (await recordsService.search(ctx, obj.id)).map((r) => r.data);

  // add formula: recomputed records count as touched, examples previewed.
  const total = {
    op: "add" as const,
    field: {
      key: "total",
      label: "Total",
      type: "formula" as const,
      formula: "price * 2",
    },
  };
  const p = await objectsService.migrate(ctx, obj.id, total, { dryRun: true });
  assert.equal(p.touched, 3);
  assert.equal(p.examples.length, 3);
  assert.deepEqual(p.examples.map((e) => e.after).sort(), [20, 40, 60]);
  const done = await objectsService.migrate(ctx, obj.id, total);
  assert.equal(done.touched, 3);
  assert.deepEqual((await data()).map((d) => d.total).sort(), [20, 40, 60]);

  // change_type to select with map + caseInsensitive: normalized samples.
  const ct = {
    op: "change_type" as const,
    field: "stage",
    type: "select" as const,
    options: ["won", "lost"],
    map: { Gagné: "won" },
    caseInsensitive: true,
  };
  const pc = await objectsService.migrate(ctx, obj.id, ct, { dryRun: true });
  assert.equal(pc.invalid, 0);
  assert.deepEqual(pc.examples.map((e) => e.after).sort(), [
    "lost",
    "won",
    "won",
  ]);
  await objectsService.migrate(ctx, obj.id, ct);
  assert.deepEqual((await data()).map((d) => d.stage).sort(), [
    "lost",
    "won",
    "won",
  ]);

  // update: expression change recomputes, options restriction is checked.
  const pu = await objectsService.migrate(
    ctx,
    obj.id,
    { op: "update", field: "total", expression: "price + 1", label: "T" },
    { dryRun: true },
  );
  assert.equal(pu.touched, 3);
  await objectsService.migrate(ctx, obj.id, {
    op: "update",
    field: "total",
    expression: "price + 1",
    label: "T",
  });
  assert.deepEqual((await data()).map((d) => d.total).sort(), [11, 21, 31]);
  await assert.rejects(
    objectsService.migrate(ctx, obj.id, {
      op: "update",
      field: "stage",
      options: ["won"],
    }),
    /invalid/,
  );
  await assert.rejects(
    objectsService.migrate(ctx, obj.id, {
      op: "update",
      field: "price",
      expression: "1",
    }),
    /not a formula/,
  );
  const pv = await objectsService.migrate(
    ctx,
    obj.id,
    { op: "update", field: "price", validation: { max: 15 } },
    { dryRun: true },
  );
  assert.equal(pv.invalid, 2);

  // update_schema: type change on a field with data refused, unless force.
  const fields = (await objectsService.get(ctx, obj.id))!.fields as {
    key: string;
    type: string;
  }[];
  const changed = fields.map((f) =>
    f.key === "price" ? { ...f, type: "text" } : f,
  );
  await assert.rejects(
    objectsService.update(ctx, obj.id, { fields: changed as never }),
    /objects\.migrate/,
  );
  assert.ok(
    await objectsService.update(
      ctx,
      obj.id,
      { fields: changed as never },
      { force: true },
    ),
  );
});

test("objects.delete: explicit confirmation required", async () => {
  const ctx = await owner("ObjDelete");
  const obj = await objectsService.create(ctx, {
    slug: "x",
    name: "X",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  await recordsService.upsert(ctx, { objectId: obj.id, data: { name: "a" } });
  await assert.rejects(
    objectsService.remove(ctx, obj.id),
    /1 record\(s\).*confirm/,
  );
  assert.ok(await objectsService.get(ctx, obj.id));
  assert.ok(await objectsService.remove(ctx, obj.id, { confirm: true }));
});
