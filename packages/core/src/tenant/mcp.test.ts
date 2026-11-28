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

test("API key: workspaces.use default is per MCP session", async () => {
  const {
    ids: [a, b],
    orgId,
  } = await org(["A", "B"]);
  const base: McpPrincipal = {
    key: `key:${crypto.randomUUID()}`,
    actor: { apiKeyId: crypto.randomUUID(), scopes: ["read", "write"] },
    allowed: [a!, b!],
    organizationId: orgId,
  };
  const s1 = { ...base, session: "s1" };
  const s2 = { ...base, session: "s2" };
  const w = { write: true };
  // No choice yet and two workspaces: writes are refused with the list.
  await assert.rejects(
    resolveMcpContext(s1, undefined, undefined, w),
    (e: Error) => e.message.includes(a!) && e.message.includes(b!),
  );
  // Reads still fall back to the first workspace.
  assert.equal((await resolveMcpContext(s1)).workspaceId, a);
  await setMcpDefault(s1, b!);
  await setMcpDefault(s2, a!);
  // Each session keeps its own default, even after the other one changes.
  assert.equal(
    (await resolveMcpContext(s1, undefined, undefined, w)).workspaceId,
    b,
  );
  assert.equal(
    (await resolveMcpContext(s2, undefined, undefined, w)).workspaceId,
    a,
  );
  // A third session has no default: write refused, header accepted.
  const s3 = { ...base, session: "s3" };
  await assert.rejects(resolveMcpContext(s3, undefined, undefined, w));
  assert.equal((await resolveMcpContext(s3, undefined, b, w)).workspaceId, b);
});

test("account tools: no workspace choice inside one organization; list capped", async () => {
  const { uid, ids } = await org(["A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
  const p: McpPrincipal = { key: `user:${uid}:acc`, actor: { userId: uid } };
  const ctx = await resolveMcpContext(p, undefined, undefined, {
    write: true,
    account: true,
  });
  assert.ok(ids.includes(ctx.workspaceId));
  await assert.rejects(
    resolveMcpContext(p, undefined, undefined, { write: true }),
    (e: Error) =>
      /\+2 more, see workspaces\.list/.test(e.message) &&
      !e.message.includes("A6"),
  );
});
