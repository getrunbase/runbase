// Integration test: RLS per workspace, master key rotation. Requires DATABASE_URL and
// SECRETS_MASTER_KEY.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { sql as q } from "drizzle-orm";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { resolveUserContext, withTenant, type TenantContext } from "../tenant";
import { keyProvider } from "./crypto";
import {
  decryptAll,
  rotateMasterKey,
  secretsService,
} from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function org(name: string) {
  const [o] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const ws = async (n: string) =>
    (
      await sql`insert into workspaces (organization_id, name) values (${o!.id}, ${n}) returning id`
    )[0]!.id as string;
  return { id: o!.id as string, a: await ws("A"), b: await ws("B") };
}
async function member(orgId: string, role: string, workspaceIds?: string[]) {
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'u', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role, workspace_ids)
    values (${uid}, ${orgId}, ${role}, ${workspaceIds ?? null})`;
  return uid;
}

test("workspace RLS: a member of A reads nothing from B", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const o = await org("RLS-WS");
  const owner = await member(o.id, "owner");
  const ctxB: TenantContext = {
    organizationId: o.id,
    workspaceId: o.b,
    actor: { userId: owner },
  };
  const obj = await objectsService.create(ctxB, {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  await recordsService.upsert(ctxB, { objectId: obj.id, data: { name: "x" } });
  await secretsService.set(ctxB, "B_KEY", "secret-b");

  const onlyA = await member(o.id, "member", [o.a]);
  // Resolved context: never B, even when requested.
  assert.equal((await resolveUserContext(onlyA, o.b))!.workspaceId, o.a);
  // Forged B context: refused.
  await assert.rejects(
    withTenant(
      { organizationId: o.id, workspaceId: o.b, actor: { userId: onlyA } },
      async () => 1,
    ),
    /Access denied/,
  );
  // In its workspace A, RLS hides B even without a filter.
  const ctxA: TenantContext = {
    organizationId: o.id,
    workspaceId: o.a,
    actor: { userId: onlyA },
  };
  const seen = await withTenant(ctxA, async (tx) => ({
    records: (
      await tx.execute(
        // Query deliberately without a workspace filter.
        q`select id from records`,
      )
    ).length,
  }));
  assert.deepEqual(seen, { records: 0 });
  for (const t of ["records", "objects", "secrets", "workspace_keys"]) {
    const n = await sql.begin(async (tx) => {
      await tx`select set_config('role', 'app_tenant', true),
        set_config('app.org_id', ${o.id}, true),
        set_config('app.workspace_id', ${o.a}, true)`;
      return (await tx.unsafe(`select count(*)::int as n from ${t}`))[0]!.n;
    });
    assert.equal(n, 0, t);
  }
  // The owner (all workspaces) always reads B.
  assert.deepEqual(await decryptAll(ctxB), { B_KEY: "secret-b" });
});

test("master key rotation keeps secrets readable", async () => {
  const o = await org("Envelope");
  const owner = await member(o.id, "owner");
  const ctx: TenantContext = {
    organizationId: o.id,
    workspaceId: o.a,
    actor: { userId: owner },
  };
  await secretsService.set(ctx, "OLD_1", "v-1");
  await secretsService.set(ctx, "OLD_2", "v-2");
  const stored = await sql<{ name: string; v: string }[]>`select name,
    value_encrypted as v from secrets where workspace_id = ${o.a} order by name`;
  assert.ok(stored.every((s) => s.v.startsWith("v2:")));
  assert.deepEqual(await decryptAll(ctx), { OLD_1: "v-1", OLD_2: "v-2" });

  // Rotation: only the DEKs change.
  const before = process.env.SECRETS_MASTER_KEY!;
  const next = randomBytes(32).toString("base64");
  const deks = async () =>
    (
      await sql<{ w: string }[]>`select dek_encrypted as w from workspace_keys
      where workspace_id = ${o.a}`
    )[0]!.w;
  const dekBefore = await deks();
  try {
    const n = await rotateMasterKey(
      keyProvider(Buffer.from(before, "base64")),
      keyProvider(Buffer.from(next, "base64")),
    );
    assert.ok(n >= 1);
    process.env.SECRETS_MASTER_KEY = next;
    assert.notEqual(await deks(), dekBefore);
    const after = await sql<{ name: string; v: string }[]>`select name,
      value_encrypted as v from secrets where workspace_id = ${o.a} order by name`;
    assert.deepEqual(after, stored);
    assert.deepEqual(await decryptAll(ctx), { OLD_1: "v-1", OLD_2: "v-2" });
  } finally {
    // Puts back the old master key for the other database tests.
    await rotateMasterKey(
      keyProvider(Buffer.from(next, "base64")),
      keyProvider(Buffer.from(before, "base64")),
    );
    process.env.SECRETS_MASTER_KEY = before;
  }
});
