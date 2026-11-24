// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { type TenantContext } from "./index";
import { workspacesService } from "../workspaces";
import { apiKeysService } from "../api-keys";
import { objectsService } from "../objects";
import { recordsService } from "../records";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0))); // closes the postgres pools

async function tenant(name: string): Promise<TenantContext> {
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

test("tenant A neither reads nor changes tenant B data", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await tenant("A");
  const b = await tenant("B");

  // Via service
  const list = await workspacesService.list(a);
  assert.deepEqual(
    list.map((w) => w.id),
    [a.workspaceId],
  );
  assert.deepEqual(await workspacesService.rename(a, b.workspaceId, "pwn"), []);
  await assert.rejects(
    workspacesService.list({ ...b, actor: a.actor }),
    /Access denied/,
  );
  await assert.rejects(
    workspacesService.list({ ...a, organizationId: "" }),
    /Missing tenant context/,
  );

  // Through raw SQL, app_tenant role + app.org_id = A
  await sql.begin(async (tx) => {
    await tx`set local role app_tenant`;
    await tx`select set_config('app.org_id', ${a.organizationId}, true)`;
    assert.equal(
      (await tx`select * from workspaces where id = ${b.workspaceId}`).length,
      0,
    );
    assert.equal(
      (await tx`select * from organizations where id = ${b.organizationId}`)
        .length,
      0,
    );
    assert.equal(
      (
        await tx`select * from memberships where organization_id = ${b.organizationId}`
      ).length,
      0,
    );
    assert.equal(
      (await tx`update workspaces set name = 'pwn' where id = ${b.workspaceId}`)
        .count,
      0,
    );
    assert.equal(
      (
        await tx`delete from memberships where organization_id = ${b.organizationId}`
      ).count,
      0,
    );
    await assert.rejects(
      tx.savepoint(
        (sp) =>
          sp`insert into workspaces (organization_id, name) values (${b.organizationId}, 'x')`,
      ),
      /row-level security/,
    );
  });
  // Without app.org_id: nothing is visible
  await sql.begin(async (tx) => {
    await tx`set local role app_tenant`;
    assert.equal((await tx`select * from workspaces`).length, 0);
  });

  const [ws] =
    await sql`select name from workspaces where id = ${b.workspaceId}`;
  assert.equal(ws!.name, "B");
});

test("API key limited to one workspace: no read or write on others", async () => {
  const a = await tenant("KeyWs");
  const [other] =
    await sql`insert into workspaces (organization_id, name) values (${a.organizationId}, 'Other') returning id`;
  const { id } = await apiKeysService.create(a, {
    name: "k",
    scopes: ["admin"],
    workspaceIds: [a.workspaceId],
  });
  const key: TenantContext = {
    ...a,
    actor: { apiKeyId: id, scopes: ["admin"] },
  };
  assert.deepEqual(
    (await workspacesService.list(key)).map((w) => w.id),
    [a.workspaceId],
  );
  assert.deepEqual(await workspacesService.rename(key, other!.id, "pwn"), []);
  await assert.rejects(
    workspacesService.remove(key, other!.id),
    /last workspace/,
  );
  const [still] =
    await sql`select name from workspaces where id = ${other!.id}`;
  assert.equal(still!.name, "Other");
  // Data of another workspace: invisible and not modifiable.
  const o = await objectsService.create(
    { ...a, workspaceId: other!.id },
    { slug: "secret", name: "S", fields: [] },
  );
  assert.equal(await objectsService.get(key, o.id), null);
  assert.deepEqual(
    (await objectsService.list(key)).map((x) => x.id),
    [],
  );
  // A workspace created by the key joins its allowed workspaces.
  const created = await workspacesService.create(key, "Via the key");
  assert.equal(
    (await workspacesService.list({ ...key, workspaceId: created.id })).length,
    2,
  );
  // The key does not see the keys covering other workspaces.
  await apiKeysService.create(a, {
    name: "large",
    scopes: ["read"],
    workspaceIds: [a.workspaceId, other!.id],
  });
  assert.deepEqual(
    (await apiKeysService.list(key)).map((k) => k.name),
    ["k"],
  );
});

test("API key limited to some objects: others and their records hidden", async () => {
  const a = await tenant("KeyObj");
  const leads = await objectsService.create(a, {
    slug: "leads",
    name: "Leads",
    fields: [{ key: "n", label: "N", type: "text" }],
  });
  const deals = await objectsService.create(a, {
    slug: "deals",
    name: "Deals",
    fields: [{ key: "n", label: "N", type: "text" }],
  });
  const secret = await recordsService.upsert(a, {
    objectId: deals.id,
    data: { n: "x" },
  });
  const { id } = await apiKeysService.create(a, {
    name: "k",
    scopes: ["write"],
    workspaceIds: [a.workspaceId],
    objects: ["leads"],
  });
  const key: TenantContext = {
    ...a,
    actor: { apiKeyId: id, scopes: ["write"] },
  };
  assert.deepEqual(
    (await objectsService.list(key)).map((o) => o.slug),
    ["leads"],
  );
  await assert.rejects(
    recordsService.get(key, secret.record.id),
    /Record .*not found|Record introuvable/i,
  );
  await recordsService.upsert(key, { objectId: leads.id, data: { n: "ok" } });
  await assert.rejects(
    recordsService.upsert(key, { objectId: deals.id, data: { n: "no" } }),
  );
});

// Safeguard: every RLS table with workspace_id carries key_workspaces and
// workspace_isolation.
test("each per-workspace table has the key_workspaces and workspace_isolation policies", async () => {
  for (const policy of ["key_workspaces", "workspace_isolation"]) {
    const missing = await sql`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id'
      where c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policies p
          where p.tablename = c.relname and p.policyname = ${policy})`;
    assert.deepEqual(
      missing.map((r) => r.relname),
      [],
      policy,
    );
  }
});
