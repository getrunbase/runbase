// Integration test (Hub sync): unique keys, upsert by field, atomic
// merge, transactions, keyset pagination, q search. Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { type TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { eventsService } from "../events";
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

async function setup(name: string) {
  const ctx = await owner(name);
  const company = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "domain", label: "Domain", type: "text", unique: true },
    ],
  });
  const contact = await objectsService.create(ctx, {
    slug: "contact",
    name: "Contact",
    fields: [
      { key: "email", label: "Email", type: "email", unique: true },
      { key: "name", label: "Name", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "company", label: "Company", type: "ref", object: "company" },
    ],
  });
  const deal = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    fields: [
      { key: "contacts", label: "Contacts", type: "refs", object: "contact" },
      { key: "owner", label: "Contact", type: "ref", object: "contact" },
    ],
  });
  return { ctx, company, contact, deal };
}

test("unique + match: upsert by email, concurrency, duplicate refused", async () => {
  const { ctx, contact } = await setup("Uniq");
  const up = (data: Record<string, unknown>) =>
    recordsService.upsert(ctx, { objectId: contact.id, match: "email", data });
  const a = await up({ email: "Jo@X.io", name: "Jo" });
  const b = await up({ email: "JO@x.io", phone: "06" });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(b.record.id, a.record.id);
  assert.equal(b.record.data.phone, "06");
  // 20 concurrent upserts of the same value: a single record.
  const rs = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      up({ email: "par@x.io", name: `n${i}` }),
    ),
  );
  assert.equal(new Set(rs.map((r) => r.record.id)).size, 1);
  // Creation without key with an already taken value: refused.
  await assert.rejects(
    recordsService.upsert(ctx, {
      objectId: contact.id,
      data: { email: "jo@x.io" },
    }),
    /Value already in use: email/,
  );
  // Update to a taken value: refused; free it then take it again: ok.
  const c = await up({ email: "c@x.io" });
  await assert.rejects(
    recordsService.update(ctx, c.record.id, { email: "JO@x.io" }),
    /already in use/,
  );
  await recordsService.update(ctx, a.record.id, { email: "jo2@x.io" });
  await recordsService.update(ctx, c.record.id, { email: "jo@x.io" });
  // match on a non-unique field: explicit error.
  await assert.rejects(
    recordsService.upsert(ctx, {
      objectId: contact.id,
      match: "name",
      data: { name: "x" },
    }),
    /unique field required/,
  );
});

test("unique added later: duplicates detected, otherwise keys built", async () => {
  const ctx = await owner("UniqLate");
  const fields = [{ key: "d", label: "D", type: "text" as const }];
  const o = await objectsService.create(ctx, { slug: "o", name: "O", fields });
  await recordsService.upsert(ctx, { objectId: o.id, data: { d: "a" } });
  const dup = await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { d: "a" },
  });
  await assert.rejects(
    objectsService.update(ctx, o.id, {
      fields: [{ ...fields[0]!, unique: true }],
    }),
    /existing duplicates \(a ×2\)/,
  );
  await recordsService.remove(ctx, dup.record.id);
  await objectsService.update(ctx, o.id, {
    fields: [{ ...fields[0]!, unique: true }],
  });
  const again = await recordsService.upsert(ctx, {
    objectId: o.id,
    match: "d",
    data: { d: "a" },
  });
  assert.equal(again.created, false);
});

test("merge: fields, refs, multiple refs, events, all or nothing", async () => {
  const { ctx, contact, deal } = await setup("Merge");
  const mk = (data: Record<string, unknown>) =>
    recordsService.upsert(ctx, { objectId: contact.id, data });
  const keep = await mk({ email: "a@x.io", name: "A" });
  const dupe = await mk({ email: "b@x.io", name: "B", phone: "07" });
  const d = await recordsService.upsert(ctx, {
    objectId: deal.id,
    data: { contacts: [keep.record.id, dupe.record.id], owner: dupe.record.id },
  });
  await eventsService.insert(ctx, { recordId: dupe.record.id, type: "call" });
  // Nonexistent id: nothing is touched.
  await assert.rejects(
    recordsService.merge(ctx, keep.record.id, [
      dupe.record.id,
      crypto.randomUUID(),
    ]),
    /not found/,
  );
  const m = await recordsService.merge(ctx, keep.record.id, [dupe.record.id]);
  assert.deepEqual(m.record.data, { email: "a@x.io", name: "A", phone: "07" });
  const dealNow = await recordsService.get(ctx, d.record.id);
  assert.deepEqual(dealNow.data.contacts, [keep.record.id]);
  assert.equal(dealNow.data.owner, keep.record.id);
  const tl = await eventsService.timeline(ctx, keep.record.id);
  assert.ok(tl.some((e) => e.type === "call"));
  await assert.rejects(recordsService.get(ctx, dupe.record.id), /not found/);
  // The email of the merged record is freed.
  const b = await mk({ email: "b@x.io" });
  assert.equal(b.created, true);
});

test("transact: all or nothing", async () => {
  const { ctx, contact, company } = await setup("Tx");
  const before = (await recordsService.search(ctx, contact.id)).length;
  await assert.rejects(
    recordsService.transact(ctx, [
      {
        op: "upsert",
        objectId: company.id,
        match: "domain",
        data: { domain: "x.io" },
      },
      { op: "upsert", objectId: contact.id, data: { email: "pas-un-email" } },
    ]),
  );
  assert.equal((await recordsService.search(ctx, company.id)).length, 0);
  const [co] = await recordsService.transact(ctx, [
    {
      op: "upsert",
      objectId: company.id,
      match: "domain",
      data: { domain: "x.io" },
    },
  ]);
  const [, ct] = await recordsService.transact(ctx, [
    {
      op: "update",
      id: (co as { record: { id: string } }).record.id,
      data: { name: "X" },
    },
    {
      op: "upsert",
      objectId: contact.id,
      match: "email",
      data: { email: "t@x.io" },
    },
  ]);
  assert.equal(
    (await recordsService.search(ctx, contact.id)).length,
    before + 1,
  );
  await recordsService.transact(ctx, [
    { op: "delete", id: (ct as { record: { id: string } }).record.id },
  ]);
  assert.equal((await recordsService.search(ctx, contact.id)).length, before);
});

test("transact: $n references the record of a previous op", async () => {
  const { ctx, contact, company, deal } = await setup("TxRef");
  const res = await recordsService.transact(ctx, [
    { op: "upsert", objectId: company.id, data: { domain: "ref.io" } },
    {
      op: "upsert",
      objectId: contact.id,
      data: { email: "r@ref.io", company: "$0" },
    },
    { op: "upsert", objectId: deal.id, data: { contacts: ["$1"] } },
    { op: "update", id: "$1", data: { name: "R" } },
    { op: "update", id: "$1", data: { name: "$0" } },
  ]);
  const id = (i: number) => (res[i] as { record: { id: string } }).record.id;
  const ct = (res[3] as { record: { data: Record<string, unknown> } }).record;
  assert.equal(ct.data.company, id(0));
  assert.equal(ct.data.name, "R");
  const last = (res[4] as { record: { data: Record<string, unknown> } }).record;
  assert.equal(last.data.name, "$0"); // text: no resolution
  assert.deepEqual(
    (res[2] as { record: { data: Record<string, unknown> } }).record.data
      .contacts,
    [id(1)],
  );
});

test("keyset after + q search (accents, quotes)", async () => {
  const { ctx, contact } = await setup("Keyset");
  await recordsService.upsertBatch(
    ctx,
    contact.id,
    Array.from({ length: 25 }, (_, i) => ({ data: { name: `Elodie ${i}` } })),
  );
  await recordsService.upsert(ctx, {
    objectId: contact.id,
    data: { name: 'dit "x"' },
  });
  const all = await recordsService.search(ctx, contact.id, {
    pagination: { limit: 100 },
  });
  const seen: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await recordsService.search(ctx, contact.id, {
      pagination: { limit: 7, after },
    });
    if (!page.length) break;
    seen.push(...page.map((r) => r.id));
    after = page.at(-1)!.id;
  }
  assert.deepEqual(
    seen,
    all.map((r) => r.id),
  );
  assert.equal(
    (await recordsService.search(ctx, contact.id, { q: "elodie 1" })).length,
    11,
  );
  assert.equal(
    (await recordsService.search(ctx, contact.id, { q: '"x"' })).length,
    1,
  );
});
