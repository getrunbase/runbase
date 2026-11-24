// MCP route: single handler, tool definitions built once,
// two concurrent keys each see their own workspaces.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { apiKeysService } from "@getrunbase/core/api-keys";
import { owner, sql } from "./test-client";
import { toolBuilds } from "./tools";
import { POST } from "./route";

after(() => setImmediate(() => process.exit(0)));

let id = 0;
async function call(key: string, name: string, args = {}) {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const msg = JSON.parse(line ? line.slice(5) : text);
  assert.ok(!msg.result.isError, msg.result.content?.[0]?.text);
  return JSON.parse(msg.result.content[0].text);
}

async function keyFor() {
  const ctx = await owner();
  await sql`update workspaces set name = ${"ws-" + ctx.workspaceId} where id = ${ctx.workspaceId}`;
  const { key } = await apiKeysService.create(ctx, {
    name: "k",
    scopes: ["read", "write", "admin"],
    workspaceIds: [ctx.workspaceId],
  });
  return { key, ws: ctx.workspaceId };
}

test("two keys in parallel: each its own workspaces, tools built once", async () => {
  const [a, b] = await Promise.all([keyFor(), keyFor()]);
  const rounds = await Promise.all(
    Array.from({ length: 10 }, (_, i) => {
      const k = i % 2 ? b : a;
      return call(k.key, i % 4 < 2 ? "workspaces.list" : "objects.list").then(
        (out) => ({ k, out }),
      );
    }),
  );
  for (const { k, out } of rounds)
    if (out.length && "active" in out[0])
      assert.deepEqual(
        out.map((w: { id: string }) => w.id),
        [k.ws],
      );
  // The resolved tenant follows the key: object created by A invisible to B.
  await Promise.all([
    call(a.key, "objects.create", {
      slug: "only_a",
      name: "A",
      fields: [{ key: "n", label: "N", type: "text" }],
    }),
    call(b.key, "objects.list"),
  ]);
  const [la, lb] = await Promise.all([
    call(a.key, "objects.list"),
    call(b.key, "objects.list"),
  ]);
  assert.deepEqual(
    la.map((o: { slug: string }) => o.slug),
    ["only_a"],
  );
  assert.deepEqual(lb, []);
  assert.equal(toolBuilds.count, 1);
});
