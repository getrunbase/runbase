// Data safety: trash, history, filter operations, CSV
// import (integration, requires DATABASE_URL and QUERY_DATABASE_URL).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { type TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { eventsService } from "../events";
import { queryService } from "../query";
import { purgeExpiredRecords, recordsService } from "./index";

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

async function crm(ctx: TenantContext) {
  const companies = await objectsService.create(ctx, {
    slug: "companies",
    name: "Companies",
    fields: [{ key: "name", label: "Nom", type: "text" }],
  });
  const contacts = await objectsService.create(ctx, {
    slug: "contacts",
    name: "Contacts",
    fields: [
      { key: "name", label: "Nom", type: "text" },
      { key: "email", label: "Email", type: "email", unique: true },
      { key: "company", label: "Company", type: "ref", object: "companies" },
      { key: "others", label: "Others", type: "refs", object: "companies" },
    ],
  });
  return { companies, contacts };
}

test("trash: deletion hidden from reads, refs cleaned, timeline kept, restore", async () => {
  const ctx = await owner("Trash");
  const { companies, contacts } = await crm(ctx);
  const up = (objectId: string, data: Record<string, unknown>) =>
    recordsService.upsert(ctx, { objectId, data }).then((r) => r.record);
  const acme = await up(companies.id, { name: "Acme" });
  const ada = await up(contacts.id, {
    name: "Ada",
    email: "ada@x.io",
    company: acme.id,
    others: [acme.id],
  });
  await eventsService.insert(ctx, { type: "call", recordId: acme.id });

  await recordsService.remove(ctx, acme.id);
  assert.deepEqual(await recordsService.search(ctx, companies.id), []);
  await assert.rejects(recordsService.get(ctx, acme.id), /not found/);
  assert.equal(await recordsService.count(ctx), 1);
  const view = await queryService.sql(ctx, "select id from records");
  assert.deepEqual(
    view.rows.map((r) => r.id),
    [ada.id],
  );
  // References removed: the contact stays editable.
  const after1 = await recordsService.get(ctx, ada.id);
  assert.equal(after1.data.company, null);
  assert.deepEqual(after1.data.others, []);
  await recordsService.update(ctx, ada.id, { name: "Ada L." });
  // Timeline kept.
  assert.equal((await eventsService.timeline(ctx, acme.id)).length, 2);

  const trash = await recordsService.trash(ctx, companies.id);
  assert.deepEqual(
    trash.map((t) => t.id),
    [acme.id],
  );
  assert.ok(trash[0]!.purgeAt > trash[0]!.deletedAt);

  await recordsService.restore(ctx, acme.id);
  const back = await recordsService.get(ctx, ada.id);
  assert.equal(back.data.company, acme.id);
  assert.deepEqual(back.data.others, [acme.id]);
  assert.equal((await recordsService.trash(ctx, companies.id)).length, 0);
  assert.equal((await eventsService.timeline(ctx, acme.id)).length, 2);
});

test("trash: unique value released, restore refused if taken; purge", async () => {
  const ctx = await owner("TrashUnique");
  const { contacts } = await crm(ctx);
  const { record: a } = await recordsService.upsert(ctx, {
    objectId: contacts.id,
    data: { email: "a@x.io" },
  });
  await recordsService.remove(ctx, a.id);
  const { record: b } = await recordsService.upsert(ctx, {
    objectId: contacts.id,
    data: { email: "a@x.io" },
  });
  await assert.rejects(recordsService.restore(ctx, a.id), /already in use/);
  // The failure rolls everything back: still in the trash.
  assert.equal((await recordsService.trash(ctx, contacts.id)).length, 1);

  await eventsService.insert(ctx, { type: "x", recordId: b.id });
  await recordsService.remove(ctx, b.id);
  assert.deepEqual(await recordsService.purge(ctx, { ids: [b.id] }), {
    purged: 1,
  });
  const [ev] =
    await sql`select record_id from events where workspace_id = ${ctx.workspaceId} and type = 'x'`;
  assert.equal(ev!.record_id, null);

  // Automatic purge: only deletions older than N days.
  await sql`update deleted_records set deleted_at = now() - interval '31 days' where id = ${a.id}`;
  assert.ok((await purgeExpiredRecords()) >= 1);
  assert.equal((await recordsService.trash(ctx, contacts.id)).length, 0);
});

test("history: before/after values, revert; merge tolerates old invalid values", async () => {
  const ctx = await owner("History");
  const obj = await objectsService.create(ctx, {
    slug: "deals",
    name: "Deals",
    fields: [
      { key: "name", label: "Nom", type: "text" },
      { key: "amount", label: "Montant", type: "number" },
    ],
  });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "A", amount: 10 },
  });
  await recordsService.update(ctx, record.id, { amount: 20 });
  const history = await recordsService.history(ctx, record.id);
  assert.deepEqual(
    history.map((h) => h.action),
    ["record.update", "record.create"],
  );
  assert.deepEqual(history[0]!.diff, {
    changed: ["amount"],
    before: { amount: 10 },
    after: { amount: 20 },
  });
  const reverted = await recordsService.revert(ctx, record.id, history[0]!.id);
  assert.equal(reverted.record.data.amount, 10);
  await assert.rejects(
    recordsService.revert(ctx, record.id, history[1]!.id),
    /Version not found/,
  );

  // The schema changes: `amount` (number) becomes invalid; an update
  // of another field passes, an invalid write of `amount` fails.
  await sql`update records set data = data || '{"amount": "ten"}' where id = ${record.id}`;
  const ok = await recordsService.update(ctx, record.id, { name: "B" });
  assert.equal(ok.record.data.name, "B");
  await assert.rejects(recordsService.update(ctx, record.id, { amount: "x" }));
});

test("update_where / delete_where: preview required", async () => {
  const ctx = await owner("Where");
  const obj = await objectsService.create(ctx, {
    slug: "leads",
    name: "Leads",
    fields: [
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["new", "won", "lost"],
      },
    ],
  });
  await recordsService.upsertBatch(ctx, obj.id, [
    { data: { status: "new" } },
    { data: { status: "new" } },
    { data: { status: "won" } },
  ]);
  const filter = {
    all: [{ field: "status", op: "eq" as const, value: "new" }],
  };
  assert.deepEqual(
    await recordsService.updateWhere(ctx, obj.id, {
      filter,
      data: { status: "lost" },
      dryRun: true,
    }),
    { dryRun: true, count: 2 },
  );
  await assert.rejects(
    recordsService.updateWhere(ctx, obj.id, {
      filter,
      data: { status: "lost" },
    }),
    /Preview required/,
  );
  await assert.rejects(
    recordsService.updateWhere(ctx, obj.id, {
      filter,
      data: { status: "lost" },
      expected: 5,
    }),
    /changed/,
  );
  assert.deepEqual(
    await recordsService.updateWhere(ctx, obj.id, {
      filter,
      data: { status: "lost" },
      expected: 2,
    }),
    { count: 2, updated: 2 },
  );
  const lost = { all: [{ field: "status", op: "eq" as const, value: "lost" }] };
  assert.deepEqual(
    await recordsService.deleteWhere(ctx, obj.id, {
      filter: lost,
      dryRun: true,
    }),
    { dryRun: true, count: 2 },
  );
  assert.deepEqual(
    await recordsService.deleteWhere(ctx, obj.id, {
      filter: lost,
      expected: 2,
    }),
    { count: 2 },
  );
  assert.equal((await recordsService.search(ctx, obj.id)).length, 1);
  assert.equal((await recordsService.trash(ctx, obj.id)).length, 2);
});

test("CSV import: mapping, dedup on unique field, failed rows, dryRun", async () => {
  const ctx = await owner("Import");
  const { contacts } = await crm(ctx);
  await recordsService.upsert(ctx, {
    objectId: contacts.id,
    data: { name: "Old", email: "ada@x.io" },
  });
  const csv = [
    "Name,Email,Ignored",
    "Ada,ADA@x.io,x",
    "Bob,bob@x.io,y",
    'Bob bis,"bob@x.io",z',
    "Bad,not-an-email,w",
  ].join("\n");
  const input = {
    csv,
    mapping: { Name: "name", Email: "email" },
    match: "email",
  };
  const dry = await recordsService.importCsv(ctx, contacts.id, {
    ...input,
    dryRun: true,
  });
  assert.equal(dry.created, 1);
  assert.equal((await recordsService.search(ctx, contacts.id)).length, 1);

  const report = await recordsService.importCsv(ctx, contacts.id, input);
  assert.deepEqual(
    { ...report, failed: report.failed.map((f) => f.line) },
    {
      total: 4,
      created: 1,
      updated: 2,
      unchanged: 0,
      failed: [5],
      failedCount: 1,
      emptyMatchKey: 0,
      skipped: 0,
      warnings: [],
    },
  );
  const names = (await recordsService.search(ctx, contacts.id))
    .map((r) => r.data.name)
    .sort();
  assert.deepEqual(names, ["Ada", "Bob bis"]);
  await assert.rejects(
    recordsService.importCsv(ctx, contacts.id, {
      ...input,
      mapping: { Missing: "name" },
    }),
    /Column missing/,
  );
});
