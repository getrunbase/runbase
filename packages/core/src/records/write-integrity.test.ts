// Integration test (write integrity): requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { databasesService } from "../databases";
import { objectsService } from "../objects";
import { overviewService } from "../overview";
import { recordsService } from "./index";
import { suggestField } from "./helpers";

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

const code = (c: string) => (e: unknown) => (e as { code?: string }).code === c;

async function contacts(ctx: TenantContext) {
  return objectsService.create(ctx, {
    slug: "contacts",
    name: "Contacts",
    fields: [
      { key: "email", label: "Email", type: "email", unique: true },
      { key: "full_name", label: "Full name", type: "text" },
      { key: "score", label: "Score", type: "number" },
    ],
  });
}

test("suggestField: label, typo, nothing close", () => {
  const fields = [
    { key: "full_name", label: "Full name", type: "text" },
    { key: "email", label: "Email", type: "email" },
  ] as Parameters<typeof suggestField>[0];
  assert.equal(suggestField(fields, "fullName"), "full_name");
  assert.equal(suggestField(fields, "emial"), "email");
  assert.equal(suggestField(fields, "budget"), undefined);
});

test("unknown fields are rejected on upsert and update", async () => {
  const ctx = await owner("Unknown fields");
  const o = await contacts(ctx);
  await assert.rejects(
    recordsService.upsert(ctx, {
      objectId: o.id,
      data: { email: "a@x.io", fullname: "A" },
    }),
    (e: unknown) =>
      code("objects.unknownFieldSuggest")(e) &&
      /full_name/.test((e as Error).message),
  );
  const { record } = await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { email: "a@x.io", full_name: "A" },
  });
  await assert.rejects(
    recordsService.update(ctx, record.id, { budget: 3 }),
    code("objects.unknownField"),
  );
});

test("emails are lowercased on write and in eq filters", async () => {
  const ctx = await owner("Emails");
  const o = await contacts(ctx);
  const { record } = await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { email: " Ann@Example.COM " },
  });
  assert.equal(record.data.email, "ann@example.com");
  const found = await recordsService.search(ctx, o.id, {
    filter: { field: "email", op: "eq", value: "ANN@example.com" },
  });
  assert.equal(found.length, 1);
});

test("CSV import: trimmed values, structured failures, test flag, purge", async () => {
  const ctx = await owner("CSV");
  const o = await contacts(ctx);
  const csv = "Email,Name,Score\n a@x.io , Ann ,3\nbad,Bob,2\nc@x.io,Cy,1\n";
  const report = await recordsService.importCsv(ctx, o.id, {
    csv,
    mapping: { Email: "email", Name: "full_name", Score: "score" },
    match: "email",
    test: true,
  });
  assert.equal(report.created, 2);
  assert.equal(report.failedCount, 1);
  const f = report.failed[0]!;
  assert.equal(f.line, 3);
  assert.equal(f.field, "email");
  assert.equal(f.value, "bad");
  assert.ok(f.message);
  const ann = await recordsService.search(ctx, o.id, {
    filter: { field: "email", op: "eq", value: "a@x.io" },
  });
  assert.equal(ann[0]!.data.full_name, "Ann");

  // Updating a test record in test mode: its timeline event is test data too.
  await recordsService.update({ ...ctx, test: true }, ann[0]!.id, {
    score: 9,
  });
  const preview = await overviewService.purgeTest(ctx, { dryRun: true });
  assert.equal(preview.records, 2);
  await overviewService.purgeTest(ctx, { confirm: true });
  const [left] =
    await sql`select count(*)::int n from events where workspace_id = ${ctx.workspaceId}`;
  assert.equal(left!.n, 0);
});

test("live write promotes a test record: purge_test keeps it", async () => {
  const ctx = await owner("Promote");
  const o = await contacts(ctx);
  const a = await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { email: "a@x.io" },
    test: true,
  });
  const b = await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { email: "b@x.io" },
    test: true,
  });
  await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { email: "c@x.io" },
    test: true,
  });
  // Live update by id, and live upsert by match with no data change.
  await recordsService.update(ctx, a.record.id, { score: 1 });
  await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { email: "b@x.io" },
    match: "email",
  });
  const preview = await overviewService.purgeTest(ctx, { dryRun: true });
  assert.equal(preview.records, 1);
  assert.deepEqual(
    [...(preview as { keptLive: string[] }).keptLive].sort(),
    [a.record.id, b.record.id].sort(),
  );
  await overviewService.purgeTest(ctx, { confirm: true });
  const [left] =
    await sql`select count(*)::int n from records where workspace_id = ${ctx.workspaceId}`;
  assert.equal(left!.n, 2);
});

test("merge keeps test data test; merging live data promotes", async () => {
  const ctx = await owner("Merge test flag");
  const o = await contacts(ctx);
  const up = (email: string, test?: boolean) =>
    recordsService.upsert(ctx, { objectId: o.id, data: { email }, test });
  const a = await up("a@x.io", true);
  const b = await up("b@x.io", true);
  const m1 = await recordsService.merge(ctx, a.record.id, [b.record.id]);
  assert.equal(m1.record.isTest, true);
  assert.equal(m1.promoted, false);
  assert.equal("warning" in m1, false);
  const c = await up("c@x.io");
  const m2 = await recordsService.merge(ctx, a.record.id, [c.record.id]);
  assert.equal(m2.record.isTest, false);
  assert.equal(m2.promoted, true);
  assert.match((m2 as { warning?: string }).warning ?? "", /test:true/);
});

test("test: true re-flags a live record so purge_test deletes it", async () => {
  const ctx = await owner("Reflag");
  const o = await contacts(ctx);
  const a = await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { email: "a@x.io" },
    test: true,
  });
  await recordsService.update(ctx, a.record.id, { score: 1 });
  const kept = await overviewService.purgeTest(ctx, { dryRun: true });
  assert.match((kept as { hint?: string }).hint ?? "", /test: true/);
  // No data change, only the flag: by update and by upsert match.
  const u = await recordsService.update(ctx, a.record.id, {}, "merge", {
    test: true,
  });
  assert.equal(u.record.isTest, true);
  const b = await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { email: "b@x.io" },
  });
  const r = await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { email: "b@x.io" },
    match: "email",
    test: true,
  });
  assert.equal(r.record.id, b.record.id);
  assert.equal(r.record.isTest, true);
  await overviewService.purgeTest(ctx, { confirm: true });
  const [left] =
    await sql`select count(*)::int n from records where workspace_id = ${ctx.workspaceId}`;
  assert.equal(left!.n, 0);
});

test("import: empty match key is counted, skipped or failed", async () => {
  const ctx = await owner("Empty match");
  const o = await contacts(ctx);
  const csv = "Email,Name\na@x.io,Ann\n,NoMail\n,NoMail2";
  const mapping = { Email: "email", Name: "full_name" };
  const created = await recordsService.importCsv(ctx, o.id, {
    csv,
    mapping,
    match: "email",
    dryRun: true,
  });
  assert.equal(created.created, 3);
  assert.equal(created.emptyMatchKey, 2);
  assert.equal(created.warnings.length, 1);
  const skipped = await recordsService.importCsv(ctx, o.id, {
    csv,
    mapping,
    match: "email",
    onEmptyMatch: "skip",
    dryRun: true,
  });
  assert.equal(skipped.created, 1);
  assert.equal(skipped.skipped, 2);
  const failed = await recordsService.importCsv(ctx, o.id, {
    csv,
    mapping,
    match: "email",
    onEmptyMatch: "fail",
  });
  assert.equal(failed.created, 1);
  assert.equal(failed.failedCount, 2);
  assert.equal(failed.failed[0]!.field, "email");
  assert.equal(failed.failed[0]!.line, 3);
});

test("databases: default slug, legacy alias, conflict", async () => {
  const ctx = await owner("Databases");
  await contacts(ctx);
  assert.ok(await databasesService.get(ctx, "default"));
  assert.ok(await databasesService.get(ctx, "defaut"));
  await assert.rejects(
    databasesService.create(ctx, { slug: "defaut", name: "X" }),
    code("data.conflict"),
  );
  await databasesService.create(ctx, { slug: "sales", name: "Sales" });
  await assert.rejects(
    databasesService.create(ctx, { slug: "sales", name: "Sales" }),
    (e: unknown) =>
      code("data.conflict")(e) && !/insert|duplicate key/i.test(String(e)),
  );
});
