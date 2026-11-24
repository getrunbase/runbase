// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { workspacesService } from "../workspaces";
import { apiKeysService, authenticateApiKey, requireScope } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

test("API keys: only hash stored, revocation, scopes", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const [org] =
    await sql`insert into organizations (name) values ('K') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'K') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'K', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const owner = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };

  const { id, key } = await apiKeysService.create(owner, {
    name: "ingest",
    scopes: ["read"],
    workspaceIds: [ws!.id],
  });
  const [row] = await sql`select key_hash from api_keys where id = ${id}`;
  assert.notEqual(row!.key_hash, key);
  assert.equal(row!.key_hash.length, 64);

  const ctx = await authenticateApiKey(key, ws!.id);
  assert.equal((await workspacesService.list(ctx)).length, 1);
  const [used] = await sql`select last_used_at from api_keys where id = ${id}`;
  assert.ok(used!.last_used_at);

  // Scope insuffisant : 403
  await assert.rejects(requireScope(ctx, "write"), { kind: "forbidden" });
  await assert.rejects(
    apiKeysService.create(ctx, {
      name: "x",
      scopes: ["admin"],
      workspaceIds: [],
    }),
    { kind: "forbidden" },
  );
  await requireScope(ctx, "read");
  await assert.rejects(authenticateApiKey(key, crypto.randomUUID()), {
    kind: "forbidden",
  });

  // Revoked key refused (including an already resolved context)
  await apiKeysService.revoke(owner, id);
  await assert.rejects(authenticateApiKey(key, ws!.id), { kind: "unauthorized" });
  await assert.rejects(workspacesService.list(ctx), /Access denied/);
  await assert.rejects(authenticateApiKey("agk_inconnue", ws!.id), {
    kind: "unauthorized",
  });
});
