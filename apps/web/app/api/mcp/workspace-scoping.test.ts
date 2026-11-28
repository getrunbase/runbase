// Workspace scoping per MCP session, strict tool inputs and the docs agents copy.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { triggerCatalog } from "@getrunbase/core/blocks";
import { setMcpDefault, type McpPrincipal } from "@getrunbase/core/tenant";
import { client, owner, raw, sql } from "./test-client";
import { MCP_INSTRUCTIONS } from "./instructions";
import { nestedPath, strictInput } from "./tools";

after(() => setImmediate(() => process.exit(0)));

const userPrincipal = (
  o: Awaited<ReturnType<typeof owner>>,
  session?: string,
): McpPrincipal => ({
  key: `user:${(o.actor as { userId: string }).userId}:cli`,
  actor: { ...o.actor, scopes: ["read", "write", "admin"] },
  ...(session ? { session } : {}),
});

test("instructions: webhook mapping without payload. prefix, as in the block", () => {
  assert.doesNotMatch(MCP_INSTRUCTIONS, /"payload\./);
  assert.match(
    MCP_INSTRUCTIONS,
    /definition\.pins\[stepId\] = \{ output, branch\? \}/,
  );
  const block = triggerCatalog().find((t) => t.type === "trigger.webhook")!;
  const example = '{ email: "email", city: "address.city" }';
  assert.ok(block.description.includes(example));
  assert.ok(MCP_INSTRUCTIONS.includes(example));
});

test("strictInput rejects unknown keys with a nested hint", () => {
  const s = strictInput(
    z.object({
      definition: z
        .object({ pins: z.record(z.string(), z.unknown()) })
        .optional(),
    }),
  );
  assert.equal(nestedPath(s, "pins"), "definition.pins");
  const r = s.safeParse({ pins: {} });
  assert.equal(r.success, false);
  assert.match(r.error!.issues[0]!.message, /did you mean definition\.pins/);
  assert.ok(s.safeParse({ definition: { pins: {} }, workspace: "x" }).success);
});

test("tool call with an unknown key is refused", async () => {
  const ctx = await owner();
  const r = await raw(ctx)("databases.list", { bogus: 1 });
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /bogus/);
});

test("sessionless write with several workspaces needs `workspace`", async () => {
  const o = await owner();
  await sql`insert into workspaces (organization_id, name) values (${o.organizationId}, 'Second')`;
  const p = userPrincipal(o);
  // A key-wide default exists, but a sessionless write ignores it.
  await setMcpDefault(p, o.workspaceId);
  const r = await raw(p)("databases.create", { slug: "a", name: "A" });
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /`workspace` parameter/);
  // Reads keep the default; an explicit workspace works.
  assert.ok(!(await raw(p)("databases.list")).isError);
  const ok = await raw(p)("databases.create", {
    slug: "a",
    name: "A",
    workspace: "second",
  });
  assert.ok(!ok.isError, ok.content[0]?.text);
  assert.match(ok.content.at(-1)!.text, /^workspace: "Second"/);
  // With a session, its own default applies.
  const s = userPrincipal(o, "sess-1");
  await setMcpDefault(s, o.workspaceId);
  const w = await raw(s)("databases.create", { slug: "b", name: "B" });
  assert.ok(!w.isError, w.content[0]?.text);
  assert.ok(w.content.at(-1)!.text.includes(o.workspaceId));
});

test("workspaces.create then workspace.describe on it; trailer names both", async () => {
  const o = await owner();
  const p = userPrincipal(o, "sess-2");
  const res = await raw(p)("workspaces.create", { name: "Fresh" });
  assert.ok(!res.isError, res.content[0]?.text);
  const created = JSON.parse(res.content[0]!.text) as { id: string };
  assert.equal(
    res.content.at(-1)!.text,
    `workspace: created "Fresh" (${created.id}); active is still "Default" (${o.workspaceId}). Call workspaces.use { workspace: "${created.id}" } to work in it.`,
  );
  const d = await client(p)("workspace.describe", { workspace: created.id });
  assert.ok(d);
  const missing = await raw(p)("workspace.describe", { workspace: "nope" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0]!.text, /inaccessible: nope/);
});

test("concurrent sessions on one principal keep their own workspace", async () => {
  const o = await owner();
  const [b] =
    await sql`insert into workspaces (organization_id, name) values (${o.organizationId}, 'Bee') returning id`;
  const a = raw(userPrincipal(o, "agent-a"));
  const bb = raw(userPrincipal(o, "agent-b"));
  await Promise.all([
    a("workspaces.use", { workspace: o.workspaceId }),
    bb("workspaces.use", { workspace: b!.id }),
  ]);
  const [ra, rb] = await Promise.all([
    a("databases.create", { slug: "a", name: "A" }),
    bb("databases.create", { slug: "b", name: "B" }),
  ]);
  assert.ok(!ra.isError && !rb.isError);
  assert.ok(ra.content.at(-1)!.text.includes(o.workspaceId));
  assert.ok(rb.content.at(-1)!.text.includes(b!.id));
  const activeOf = async (c: typeof a) =>
    (
      JSON.parse((await c("workspaces.list")).content[0]!.text) as {
        id: string;
        active: boolean;
      }[]
    )
      .filter((w) => w.active)
      .map((w) => w.id);
  assert.deepEqual(await activeOf(a), [o.workspaceId]);
  assert.deepEqual(await activeOf(bb), [b!.id]);
  // workspaces.create from agent b is not blocked by its active workspace and
  // reports the active one like workspaces.list.
  const c = await bb("workspaces.create", { name: "Gamma" });
  assert.ok(!c.isError, c.content[0]?.text);
  assert.ok(
    c.content.at(-1)!.text.includes(`active is still "Bee" (${b!.id})`),
  );
  assert.deepEqual(await activeOf(a), [o.workspaceId]);
});

test("sessionless: workspaces.use does not persist, writes need `workspace`", async () => {
  const o = await owner();
  const [b] =
    await sql`insert into workspaces (organization_id, name) values (${o.organizationId}, 'Bee') returning id`;
  const call = raw(userPrincipal(o));
  const u = JSON.parse(
    (await call("workspaces.use", { workspace: b!.id })).content[0]!.text,
  );
  assert.equal(u.persisted, false);
  assert.match(u.note, /no MCP session/);
  const l = await call("workspaces.list");
  const list = JSON.parse(l.content[0]!.text) as { active: boolean }[];
  assert.ok(list.every((w) => !w.active));
  assert.match(l.content.at(-1)!.text, /no active workspace/);
  const w = await call("databases.create", { slug: "a", name: "A" });
  assert.equal(w.isError, true);
  assert.match(w.content[0]!.text, /`workspace` parameter/);
  // A session started later inherits nothing from the sessionless call.
  const s = raw(userPrincipal(o, "fresh"));
  const sl = JSON.parse((await s("workspaces.list")).content[0]!.text) as {
    id: string;
    active: boolean;
  }[];
  assert.deepEqual(
    sl.filter((x) => x.active).map((x) => x.id),
    [o.workspaceId],
  );
  // workspaces.create needs no active workspace.
  const c = await call("workspaces.create", { name: "Delta" });
  assert.ok(!c.isError, c.content[0]?.text);
  assert.match(c.content.at(-1)!.text, /no active workspace/);
  // secrets.set confirms without echoing the value.
  const sec = await call("secrets.set", {
    name: "K",
    value: "v",
    workspace: b!.id,
  });
  assert.deepEqual(JSON.parse(sec.content[0]!.text), {
    name: "K",
    updated: true,
  });
});
