// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { apiKeysService, authenticateApiKey } from "../api-keys";
import { type TenantContext } from "../tenant";
import { workspacesService } from "../workspaces";
import { auditService } from "./index";

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

test("who changed a resource, and when (user then API key)", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("A");
  const b = await owner("B");
  const uid = (a.actor as { userId: string }).userId;

  const ws = await workspacesService.create(a, "Second");
  const { id: keyId, key } = await apiKeysService.create(a, {
    name: "mcp",
    scopes: ["admin"],
    // The key must cover the renamed workspace (RLS key_workspaces).
    workspaceIds: [a.workspaceId, ws.id],
  });
  const viaKey = await authenticateApiKey(key, a.workspaceId);
  await workspacesService.rename(viaKey, ws.id, "Renamed");

  const h = await auditService.history(a, { type: "workspace", id: ws.id });
  assert.deepEqual(
    h.map((e) => [e.action, e.actorUserId, e.actorApiKeyId]),
    [
      ["workspace.rename", null, keyId],
      ["workspace.create", uid, null],
    ],
  );
  assert.deepEqual(h[0]!.diff, { name: ["Second", "Renamed"] });
  assert.ok(h[0]!.createdAt instanceof Date);

  // Isolation: another organization sees nothing.
  assert.equal(
    (await auditService.history(b, { type: "workspace", id: ws.id })).length,
    0,
  );
  // Append-only for the application role.
  await assert.rejects(
    sql.begin(async (tx) => {
      await tx`set local role app_tenant`;
      await tx`delete from audit_log`;
    }),
    /permission denied/,
  );
});
