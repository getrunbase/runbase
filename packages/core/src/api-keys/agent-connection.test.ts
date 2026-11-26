// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { agentConnection, apiKeysService, authenticateApiKey } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

test("agentConnection: OAuth grant of the viewer, or a key used on the workspace", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const [org] =
    await sql`insert into organizations (name) values ('A') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'A') returning id`;
  const uid = crypto.randomUUID();
  const other = crypto.randomUUID();
  for (const id of [uid, other])
    await sql`insert into "user" (id, name, email) values (${id}, 'A', ${id + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role, accepted_at) values (${uid}, ${org!.id}, 'owner', now())`;
  const ctx = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  assert.deepEqual(await agentConnection(ctx), {
    connected: false,
    via: null,
    client: null,
  });

  // Another account's grant does not count for this viewer.
  const client = crypto.randomUUID();
  await sql`insert into oauth_client (id, client_id, name, redirect_uris) values (${client}, ${client}, 'Claude', ${["http://localhost/cb"]})`;
  const grant = (user: string) =>
    sql`insert into oauth_refresh_token (id, token, client_id, user_id, expires_at, created_at, scopes)
        values (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${client}, ${user}, now() + interval '30 days', now(), ${["read"]})`;
  await grant(other);
  assert.equal((await agentConnection(ctx)).connected, false);

  await grant(uid);
  assert.deepEqual(await agentConnection(ctx), {
    connected: true,
    via: "oauth",
    client: "Claude",
  });

  // Revoked grant: back to a key, used on this workspace.
  await sql`update oauth_refresh_token set revoked = now() where user_id = ${uid}`;
  assert.equal((await agentConnection(ctx)).connected, false);
  const { key } = await apiKeysService.create(ctx, {
    name: "agent",
    scopes: ["read"],
    workspaceIds: [ws!.id],
  });
  assert.equal((await agentConnection(ctx)).connected, false);
  await authenticateApiKey(key, ws!.id);
  assert.deepEqual(await agentConnection(ctx), {
    connected: true,
    via: "key",
    client: null,
  });
});
