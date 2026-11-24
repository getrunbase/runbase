// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { type TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { databasesService } from "../databases";
import { recordsService, type SearchInput } from "./index";
import { records } from "../db/schema";
import { compileFilter, type Filter } from "../filter";

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

const fields = [
  { key: "name", label: "Name", type: "text" as const },
  { key: "size", label: "Taille", type: "number" as const },
  { key: "active", label: "Active", type: "bool" as const },
  { key: "since", label: "Since", type: "date" as const },
  { key: "tier", label: "Tier", type: "select" as const, options: ["a", "b"] },
  {
    key: "tags",
    label: "Tags",
    type: "multi_select" as const,
    options: ["x", "y"],
  },
  { key: "mail", label: "Mail", type: "email" as const },
  { key: "web", label: "Site", type: "url" as const },
  { key: "meta", label: "Meta", type: "json" as const },
  { key: "owner", label: "Owner", type: "ref" as const, object: "user" },
];

test("compileFilter: keys and values as parameters, no concatenation", () => {
  const evil = "x'); drop table records; --";
  const q = new PgDialect().sqlToQuery(
    compileFilter(records.data, fields, {
      any: [{ field: "name", op: "eq", value: evil }],
    }),
  );
  assert.ok(!q.sql.includes(evil));
  assert.ok(q.params.includes(evil));
  assert.throws(() =>
    compileFilter(records.data, fields, { field: "nope", op: "eq", value: 1 }),
  );
});

test("search: all/any on all types, sort and pagination", async () => {
  const ctx = await owner("Search");
  const user = await objectsService.create(ctx, {
    slug: "user",
    name: "User",
    fields: [],
  });
  const obj = await objectsService.create(ctx, {
    slug: "co",
    name: "Co",
    fields,
  });
  const owner1 = (
    await recordsService.upsert(ctx, {
      objectId: user.id,
      data: {},
      backfill: true,
    })
  ).record.id;
  const rows = [
    {
      name: "Acme",
      size: 10,
      active: true,
      since: "2024-01-01",
      tier: "a",
      tags: ["x"],
      mail: "a@acme.io",
      web: "https://acme.io",
      meta: { k: 1 },
      owner: owner1,
    },
    {
      name: "Beta",
      size: 200,
      active: false,
      since: "2025-06-01",
      tier: "b",
      tags: ["x", "y"],
      mail: "b@beta.io",
      web: "https://beta.io",
      meta: { k: 2 },
    },
    {
      name: "Gamma",
      size: 50,
      active: true,
      since: "2023-03-01",
      tier: "b",
      tags: [],
    },
  ];
  for (const [i, data] of rows.entries())
    await recordsService.upsert(ctx, {
      objectId: obj.id,
      externalId: `e${i}`,
      data,
      backfill: true,
    });

  const names = async (filter: Filter, sort?: SearchInput["sort"]) =>
    (await recordsService.search(ctx, obj.id, { filter, sort })).map(
      (r) => r.data.name,
    );

  assert.deepEqual(
    await names({ field: "size", op: "gt", value: 20 }, [{ field: "size" }]),
    ["Gamma", "Beta"],
  );
  assert.deepEqual(
    await names({ field: "active", op: "eq", value: true }, [
      { field: "name" },
    ]),
    ["Acme", "Gamma"],
  );
  assert.deepEqual(
    await names({ field: "since", op: "gte", value: "2024-01-01" }, [
      { field: "since", dir: "desc" },
    ]),
    ["Beta", "Acme"],
  );
  assert.deepEqual(await names({ field: "tier", op: "in", value: ["a"] }), [
    "Acme",
  ]);
  assert.deepEqual(await names({ field: "tags", op: "contains", value: "y" }), [
    "Beta",
  ]);
  assert.deepEqual(await names({ field: "tags", op: "is_empty" }), ["Gamma"]);
  assert.deepEqual(
    await names({ field: "mail", op: "contains", value: "BETA" }),
    ["Beta"],
  );
  assert.deepEqual(
    await names({ field: "web", op: "eq", value: "https://acme.io" }),
    ["Acme"],
  );
  assert.deepEqual(await names({ field: "meta", op: "eq", value: { k: 2 } }), [
    "Beta",
  ]);
  assert.deepEqual(await names({ field: "owner", op: "eq", value: owner1 }), [
    "Acme",
  ]);
  assert.deepEqual(
    await names({ field: "owner", op: "is_empty" }, [{ field: "name" }]),
    ["Beta", "Gamma"],
  );

  // Combination: active AND (tier b OR size < 20)
  assert.deepEqual(
    await names(
      {
        all: [
          { field: "active", op: "eq", value: true },
          {
            any: [
              { field: "tier", op: "eq", value: "b" },
              { field: "size", op: "lt", value: 20 },
            ],
          },
        ],
      },
      [{ field: "name", dir: "desc" }],
    ),
    ["Gamma", "Acme"],
  );

  const [first] = await recordsService.search(ctx, obj.id, {
    sort: [{ field: "size" }],
    pagination: { limit: 1 },
  });
  const page = await recordsService.search(ctx, obj.id, {
    sort: [{ field: "size" }],
    pagination: { limit: 1, after: first!.id },
  });
  assert.deepEqual(
    page.map((r) => r.data.name),
    ["Gamma"],
  );
});

test("refs: condition on a field of the referenced record and resolved get", async () => {
  const ctx = await owner("Refs");
  const company = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "size", label: "Taille", type: "number" },
    ],
  });
  const contact = await objectsService.create(ctx, {
    slug: "contact",
    name: "Contact",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "company", label: "Company", type: "ref", object: "company" },
    ],
  });
  const up = async (objectId: string, data: Record<string, unknown>) =>
    (await recordsService.upsert(ctx, { objectId, data, backfill: true }))
      .record;
  const big = await up(company.id, { name: "Big", size: 500 });
  const small = await up(company.id, { name: "Small", size: 5 });
  const alice = await up(contact.id, { name: "Alice", company: big.id });
  await up(contact.id, { name: "Bob", company: small.id });
  await up(contact.id, { name: "Carl" });

  const names = async (filter: Filter) =>
    (
      await recordsService.search(ctx, contact.id, {
        filter,
        sort: [{ field: "name" }],
      })
    ).map((r) => r.data.name);
  assert.deepEqual(
    await names({ field: "company.size", op: "gt", value: 100 }),
    ["Alice"],
  );
  assert.deepEqual(
    await names({ field: "company.name", op: "in", value: ["Big", "Small"] }),
    ["Alice", "Bob"],
  );
  await assert.rejects(names({ field: "company.nope", op: "eq", value: 1 }));
  await assert.rejects(names({ field: "name.x", op: "eq", value: 1 }));

  const got = await recordsService.get(ctx, alice.id);
  assert.equal(got.refs.company?.data.name, "Big");
});

test("relations: multi-level paths, refs, inverses, include, validation", async () => {
  const ctx = await owner("Relations");
  await databasesService.create(ctx, { slug: "crm", name: "CRM" });
  const entreprise = await objectsService.create(ctx, {
    slug: "entreprise",
    name: "Company",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "taille", label: "Taille", type: "number" },
    ],
  });
  const contact = await objectsService.create(ctx, {
    slug: "contact",
    name: "Contact",
    database: "crm",
    fields: [
      { key: "name", label: "Name", type: "text" },
      {
        key: "entreprise",
        label: "Company",
        type: "ref",
        object: "entreprise",
      },
    ],
  });
  const deal = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    database: "crm",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "contact", label: "Contact", type: "ref", object: "contact" },
      {
        key: "entreprises",
        label: "Companies",
        type: "refs",
        object: "entreprise",
      },
    ],
  });
  const up = async (objectId: string, data: Record<string, unknown>) =>
    (await recordsService.upsert(ctx, { objectId, data, backfill: true }))
      .record;
  const big = await up(entreprise.id, { name: "Big", taille: 500 });
  const small = await up(entreprise.id, { name: "Small", taille: 5 });
  const alice = await up(contact.id, { name: "Alice", entreprise: big.id });
  const bob = await up(contact.id, { name: "Bob", entreprise: small.id });
  const d1 = await up(deal.id, {
    name: "D1",
    contact: alice.id,
    entreprises: [big.id],
  });
  const d2 = await up(deal.id, {
    name: "D2",
    contact: bob.id,
    entreprises: [],
  });

  const names = async (objectId: string, filter: Filter) =>
    (
      await recordsService.search(ctx, objectId, {
        filter,
        sort: [{ field: "name" }],
      })
    ).map((r) => r.data.name);
  const cond = {
    field: "contact.entreprise.taille",
    op: "gt",
    value: 50,
  } as const;
  assert.deepEqual(await names(deal.id, cond), ["D1"]);
  assert.deepEqual(
    await names(deal.id, { field: "entreprises.name", op: "eq", value: "Big" }),
    ["D1"],
  );
  assert.deepEqual(
    await names(deal.id, {
      field: "entreprises",
      op: "contains",
      value: big.id,
    }),
    ["D1"],
  );
  // Inverses: companies with a contact Bob, a deal D1.
  assert.deepEqual(
    await names(entreprise.id, {
      field: "contact.name",
      op: "eq",
      value: "Bob",
    }),
    ["Small"],
  );
  assert.deepEqual(
    await names(entreprise.id, {
      field: "contact.deal.name",
      op: "eq",
      value: "D1",
    }),
    ["Big"],
  );
  assert.equal(await recordsService.matches(ctx, d1.id, cond), true);
  assert.equal(await recordsService.matches(ctx, d2.id, cond), false);

  const got = await recordsService.get(ctx, big.id, {
    include: ["contact", "deal", "contact.deal"],
  });
  const ids = (x: unknown) => (x as { id: string }[]).map((r) => r.id);
  assert.deepEqual(ids(got.included.contact), [alice.id]);
  assert.deepEqual(ids(got.included.deal), [d1.id]);
  assert.deepEqual(ids(got.included["contact.deal"]), [d1.id]);
  const fiche = await recordsService.get(ctx, d1.id, {
    include: ["contact.entreprise"],
  });
  assert.equal(
    (fiche.included["contact.entreprise"] as { id: string } | null)?.id,
    big.id,
  );
  assert.equal(fiche.refs.contact?.id, alice.id);
  await assert.rejects(recordsService.get(ctx, d1.id, { include: ["nope"] }));

  // Validation: nonexistent target, from another object or another workspace.
  await assert.rejects(
    up(contact.id, { name: "X", entreprise: bob.id }),
    /Invalid reference/,
  );
  await assert.rejects(
    up(deal.id, { name: "X", entreprises: [big.id, crypto.randomUUID()] }),
    /Invalid reference/,
  );
  const other = await owner("Other");
  const o = await objectsService.create(other, {
    slug: "entreprise",
    name: "Company",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const foreign = (
    await recordsService.upsert(other, {
      objectId: o.id,
      data: { name: "F" },
      backfill: true,
    })
  ).record;
  await assert.rejects(
    recordsService.update(ctx, alice.id, { entreprise: foreign.id }),
    /Invalid reference/,
  );

  // Old schema: relation target stored as uuid and not as slug.
  await sql`update objects set fields = (select jsonb_agg(case when f->>'key' = 'entreprise' then f || jsonb_build_object('object', ${entreprise.id}::text) else f end) from jsonb_array_elements(fields) f) where id = ${contact.id}`;
  await recordsService.update(ctx, alice.id, { entreprise: small.id });
});
