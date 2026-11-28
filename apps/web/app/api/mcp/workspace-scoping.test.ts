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
