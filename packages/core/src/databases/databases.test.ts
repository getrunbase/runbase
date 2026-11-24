// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { type TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { busQueue } from "../bus";
import { recordsService } from "../records";
import { databasesService } from "./index";

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

const name = [{ key: "name", label: "Name", type: "text" as const }];

test("CRM database with Contacts, Companies and Deals", async () => {
  const ctx = await owner("DB");
  const crm = await databasesService.create(ctx, {
    slug: "crm",
    name: "CRM",
    icon: "users",
  });
  for (const [slug, n] of [
    ["contacts", "Contacts"],
    ["companies", "Entreprises"],
    ["deals", "Deals"],
  ] as const)
    await objectsService.create(ctx, {
      slug,
      name: n,
      fields: name,
      database: "crm",
    });
  // Without database: filed under "Default", created on the fly.
  const loose = await objectsService.create(ctx, {
    slug: "misc",
    name: "Divers",
    fields: name,
  });

  const contacts = (await objectsService.get(ctx, "contacts"))!;
  await recordsService.upsert(ctx, {
    objectId: contacts.id,
    data: { name: "Ada" },
  });
  const got = await databasesService.get(ctx, "crm");
  assert.deepEqual(
    got!.objects.map((o) => o.records),
    [1, 0, 0],
  );
  assert.deepEqual(
    got!.objects.map((o) => o.name),
    ["Contacts", "Entreprises", "Deals"],
  );
  const def = await databasesService.get(ctx, "defaut");
  assert.equal(def!.objects[0]!.id, loose.id);
  assert.equal((await databasesService.list(ctx)).length, 2);
  // Object slug unique per workspace, across all databases.
  await assert.rejects(
    objectsService.create(ctx, { slug: "deals", name: "x", fields: name }),
  );
  await assert.rejects(
    objectsService.create(ctx, {
      slug: "y",
      name: "y",
      fields: name,
      database: "nope",
    }),
    /not found/,
  );

  const renamed = await databasesService.rename(ctx, crm.id, {
    name: "Sales",
  });
  assert.equal(renamed!.name, "Sales");

  await assert.rejects(databasesService.remove(ctx, crm.id), /not empty/);
  assert.ok(await databasesService.remove(ctx, crm.id, { confirm: true }));
  assert.equal(await objectsService.get(ctx, "contacts"), null);

  const actions = await sql`select action from audit_log
    where workspace_id = ${ctx.workspaceId} and resource_type = 'database' order by created_at`;
  assert.deepEqual(
    actions.map((a) => a.action),
    [
      "database.create",
      "database.create",
      "database.update",
      "database.delete",
    ],
  );
});

test("isolation: database inaccessible from another organization", async () => {
  const a = await owner("DBA");
  const b = await owner("DBB");
  await databasesService.create(a, { slug: "crm", name: "CRM" });
  await assert.rejects(
    databasesService.get({ ...b, workspaceId: a.workspaceId }, "crm"),
    /Access denied/,
  );
  assert.equal(await databasesService.get(b, "crm"), null);
});

test("remove force: record.deleted published and object.delete audited per object", async () => {
  const ctx = await owner("DBForce");
  const db = await databasesService.create(ctx, { slug: "crm", name: "CRM" });
  const ids: string[] = [];
  const objs: string[] = [];
  for (const slug of ["contacts", "deals"]) {
    const o = await objectsService.create(ctx, {
      slug,
      name: slug,
      fields: name,
      database: "crm",
    });
    objs.push(o.id);
    const { record } = await recordsService.upsert(ctx, {
      objectId: o.id,
      data: { name: slug },
      backfill: true,
    });
    ids.push(record.id);
  }
  assert.ok(await databasesService.remove(ctx, db.id, { confirm: true }));
  const jobs = (
    await busQueue().getJobs(["waiting", "prioritized", "active", "completed", "failed"])
  )
    .filter(
      (j) =>
        j?.name === "record.deleted" && j.data.workspaceId === ctx.workspaceId,
    )
    .map((j) => j.data.id)
    .sort();
  assert.deepEqual(jobs, ids.sort());
  const audited = await sql`select resource_id from audit_log
    where workspace_id = ${ctx.workspaceId} and action = 'object.delete'`;
  assert.deepEqual(audited.map((a) => a.resource_id).sort(), objs.sort());
});
