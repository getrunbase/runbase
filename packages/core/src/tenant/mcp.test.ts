// MCP workspace resolution: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { resolveMcpContext, setMcpDefault, type McpPrincipal } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function org(names: string[]) {
  const [o] =
    await sql`insert into organizations (name) values ('M') returning id`;
  const ids: string[] = [];
  for (const name of names) {
    const [w] =
      await sql`insert into workspaces (organization_id, name) values (${o!.id}, ${name}) returning id`;
    ids.push(w!.id);
  }
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'M', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${o!.id}, 'owner')`;
  return { uid, ids, orgId: o!.id as string };
}

test("user: first by default, default set, param wins, refused outside org", async () => {
  const {
    uid,
    ids: [a, b],
  } = await org(["A", "B"]);
  const other = await org(["X"]);
  const p: McpPrincipal = { key: `user:${uid}:c`, actor: { userId: uid } };
  assert.equal((await resolveMcpContext(p)).workspaceId, a);
  await setMcpDefault(p, "b");
  assert.equal((await resolveMcpContext(p)).workspaceId, b);
  assert.equal((await resolveMcpContext(p, a)).workspaceId, a);
  await assert.rejects(resolveMcpContext(p, other.ids[0]), /inaccessible/);
  await assert.rejects(setMcpDefault(p, other.ids[0]!), /inaccessible/);
  // Default deleted: fallback to the first one.
  await sql`delete from workspaces where id = ${b!}`;
  assert.equal((await resolveMcpContext(p)).workspaceId, a);
});

test("API key: limited to its workspaces", async () => {
  const {
    ids: [a, b, c],
    orgId,
  } = await org(["A", "B", "C"]);
  const foreign = (await org(["F"])).ids[0]!;
  const p: McpPrincipal = {
    key: "key:k",
    actor: { apiKeyId: crypto.randomUUID(), scopes: ["read"] },
    allowed: [a!, b!, foreign],
    organizationId: orgId,
  };
  assert.equal((await resolveMcpContext(p)).workspaceId, a);
  assert.equal((await resolveMcpContext(p, b)).workspaceId, b);
  await assert.rejects(resolveMcpContext(p, c), /inaccessible/);
  // Workspace of another organization listed in the key: invisible.
  await assert.rejects(resolveMcpContext(p, foreign), /inaccessible/);
});
