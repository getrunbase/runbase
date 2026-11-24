// Account-bound MCP: workspace per call, default per client, limited keys.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { accessibleWorkspaces, type McpPrincipal } from "@getrunbase/core/tenant";
import { client, owner, raw, sql } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

test("OAuth token: several workspaces, default, parameter, refusal outside the org", async () => {
  const o = await owner();
  const [b] =
    await sql`insert into workspaces (organization_id, name) values (${o.organizationId}, 'Second') returning id`;
  const other = await owner();
  const p: McpPrincipal = {
    key: `user:${(o.actor as { userId: string }).userId}:cli`,
    actor: { ...o.actor, scopes: ["read", "write", "admin"] },
  };
  const call = client(p);
  const active = async () =>
    ((await call("workspaces.list")) as { id: string; active: boolean }[])
      .filter((w) => w.active)
      .map((w) => w.id);

  assert.deepEqual(await active(), [o.workspaceId]);
  await call("databases.create", {
    slug: "dans-b",
    name: "Dans B",
    workspace: "second",
  });
  assert.deepEqual(await call("databases.list"), []);
  assert.equal((await call("workspaces.use", { workspace: b!.id })).id, b!.id);
  assert.deepEqual(await active(), [b!.id]);
  assert.equal((await call("databases.list")).length, 1);
  assert.deepEqual(
    await call("databases.list", { workspace: o.workspaceId }),
    [],
  );

  const r = await raw(p)("databases.list", { workspace: other.workspaceId });
  assert.ok(r.isError && /inaccessible/.test(r.content[0]!.text));
  const u = await raw(p)("workspaces.use", { workspace: other.workspaceId });
  assert.ok(u.isError);
  assert.deepEqual(await active(), [b!.id]);
});

test("API key limited to its workspaces", async () => {
  const o = await owner();
  const [b, c] =
    await sql`insert into workspaces (organization_id, name) values (${o.organizationId}, 'B'), (${o.organizationId}, 'C') returning id`;
  const [k] =
    await sql`insert into api_keys (organization_id, name, workspace_ids, scopes, key_hash) values (${o.organizationId}, 'k', ${[o.workspaceId, b!.id]}, ${["read", "write"]}, ${crypto.randomUUID()}) returning id`;
  const p: McpPrincipal = {
    key: `key:${k!.id}`,
    actor: { apiKeyId: k!.id, scopes: ["read", "write"] },
    allowed: [o.workspaceId, b!.id],
    organizationId: o.organizationId,
  };
  const call = client(p);
  const ids = (await call("workspaces.list")) as {
    id: string;
    active: boolean;
  }[];
  assert.deepEqual(
    ids.map((w) => [w.id, w.active]),
    [
      [o.workspaceId, true],
      [b!.id, false],
    ],
  );
  assert.deepEqual(await call("databases.list", { workspace: b!.id }), []);
  const r = await raw(p)("databases.list", { workspace: c!.id });
  assert.ok(r.isError && /inaccessible/.test(r.content[0]!.text));
  assert.ok((await raw(p)("workspaces.use", { workspace: c!.id })).isError);
  // Role: a key without admin does not create a workspace.
  assert.ok((await raw(p)("workspaces.create", { name: "X" })).isError);
});

test("x-workspace-id header: fallback only without a client default", async () => {
  const o = await owner();
  const [b] =
    await sql`insert into workspaces (organization_id, name) values (${o.organizationId}, 'B') returning id`;
  const p: McpPrincipal = {
    key: `user:${(o.actor as { userId: string }).userId}:hdr`,
    actor: { ...o.actor, scopes: ["read", "write", "admin"] },
  };
  const call = client(p, b!.id);
  const active = async () =>
    ((await call("workspaces.list")) as { id: string; active: boolean }[])
      .filter((w) => w.active)
      .map((w) => w.id);
  assert.deepEqual(await active(), [b!.id]);
  await call("workspaces.use", { workspace: o.workspaceId });
  assert.deepEqual(await active(), [o.workspaceId]);
  await call("databases.create", { slug: "a", name: "A" });
  assert.equal(
    (await call("databases.list", { workspace: o.workspaceId })).length,
    1,
  );
});

test("rename/delete target the workspace id, even in another organization", async () => {
  const o = await owner();
  const other = await owner();
  const uid = (o.actor as { userId: string }).userId;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${other.organizationId}, 'owner')`;
  const [x] =
    await sql`insert into workspaces (organization_id, name) values (${other.organizationId}, 'X') returning id`;
  const call = client({
    key: `user:${uid}:cross`,
    actor: { ...o.actor, scopes: ["read", "write", "admin"] },
  });
  await call("workspaces.rename", { id: x!.id, name: "Renommé" });
  const [row] = await sql`select name from workspaces where id = ${x!.id}`;
  assert.equal(row!.name, "Renommé");
  await call("workspaces.delete", { id: x!.id });
  assert.equal(
    (await sql`select 1 from workspaces where id = ${x!.id}`).length,
    0,
  );
});

test("workspace parameter on every tool, required args kept", async () => {
  const o = await owner();
  const [b] =
    await sql`insert into workspaces (organization_id, name) values (${o.organizationId}, 'B') returning id`;
  const p: McpPrincipal = {
    key: `user:${(o.actor as { userId: string }).userId}:par`,
    actor: { ...o.actor, scopes: ["read", "write", "admin"] },
  };
  const tools = await raw(p).list();
  const missing = tools
    .filter((t) => !["workspaces.list", "workspaces.use"].includes(t.name))
    .filter((t) => !t.inputSchema.properties?.workspace)
    .map((t) => t.name);
  assert.deepEqual(missing, []);
  const call = client(p);
  await call("objects.create", {
    slug: "lead",
    name: "Lead",
    fields: [{ key: "email", label: "Email", type: "email", required: true }],
    workspace: b!.id,
  });
  await call("records.upsert", {
    object: "lead",
    data: { email: "a@x.io" },
    workspace: b!.id,
  });
  const found = await call("records.search", {
    object: "lead",
    workspace: b!.id,
  });
  assert.equal(found.records.length, 1);
  assert.ok((await raw(p)("records.search", { object: "lead" })).isError);
});

test("workspace API key: rename/delete of another one refused, tools limited", async () => {
  const o = await owner();
  const [b] =
    await sql`insert into workspaces (organization_id, name) values (${o.organizationId}, 'B') returning id`;
  const [k] =
    await sql`insert into api_keys (organization_id, name, workspace_ids, scopes, key_hash, tools) values (${o.organizationId}, 'k', ${[o.workspaceId]}, ${["admin"]}, ${crypto.randomUUID()}, ${["workspaces.rename", "workspaces.delete", "members.list"]}) returning id`;
  const p: McpPrincipal = {
    key: `key:${k!.id}`,
    actor: { apiKeyId: k!.id, scopes: ["admin"] },
    allowed: [o.workspaceId],
    organizationId: o.organizationId,
    tools: ["workspaces.rename", "workspaces.delete", "members.list"],
  };
  const call = raw(p);
  // `workspace` allowed but `id` of another workspace: nothing changes.
  const r = await call("workspaces.rename", {
    workspace: o.workspaceId,
    id: b!.id,
    name: "pwn",
  });
  assert.equal(r.content[0]!.text, "[]");
  assert.ok(
    (await call("workspaces.delete", { workspace: o.workspaceId, id: b!.id }))
      .isError,
  );
  const [still] = await sql`select name from workspaces where id = ${b!.id}`;
  assert.equal(still!.name, "B");
  // Tools outside the list: not exposed.
  const names = (await call.list()).map((t) => t.name);
  assert.ok(names.includes("members.list"));
  assert.ok(!names.includes("records.search"));
});

test("members through MCP; an end user has no MCP access", async () => {
  const o = await owner();
  const admin = {
    ...o,
    actor: { ...o.actor, scopes: ["read", "write", "admin"] },
  } as typeof o;
  const call = client(admin);
  const email = `${crypto.randomUUID()}@x.io`;
  await call("members.invite", { email, role: "end_user" });
  const list = (await call("members.list")) as {
    id: string;
    email: string;
    pending: boolean;
    userId: string;
  }[];
  const inv = list.find((m) => m.email === email)!;
  assert.equal(inv.pending, true);
  await sql`update memberships set accepted_at = now() where id = ${inv.id}`;
  const endUser: McpPrincipal = {
    key: `user:${inv.userId}:t`,
    actor: { userId: inv.userId, scopes: ["read"] },
  };
  assert.deepEqual(await accessibleWorkspaces(endUser), []);
  await call("members.set_role", { id: inv.id, role: "viewer" });
  assert.equal((await accessibleWorkspaces(endUser)).length, 1);
  await call("members.remove", { id: inv.id });
  assert.deepEqual(await accessibleWorkspaces(endUser), []);
});
