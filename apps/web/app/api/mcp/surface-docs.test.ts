// MCP surface that agents copy from: batch defaults, strict schemas,
// workspace settings and the workspace line on write responses.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner, raw } from "./test-client";
import { isWriteTool } from "./tools";
import { withBatchDefaults } from "./tools/records";
import { MCP_INSTRUCTIONS } from "./instructions";

after(() => setImmediate(() => process.exit(0)));

test("withBatchDefaults: top-level values fill items, item values win", () => {
  const out = withBatchDefaults(
    [{ data: {} }, { data: {}, test: false, match: undefined }],
    { test: true, match: "email", mode: undefined },
  );
  assert.deepEqual(out, [
    { test: true, match: "email", data: {} },
    { test: false, match: "email", data: {} },
  ]);
});

test("isWriteTool separates reads from writes", () => {
  for (const n of ["records.search", "workspace.settings", "objects.get"])
    assert.equal(isWriteTool(n), false, n);
  for (const n of ["records.upsert_batch", "workflows.create", "secrets.set"])
    assert.equal(isWriteTool(n), true, n);
});

test("instructions document the shapes agents copy", () => {
  assert.match(MCP_INSTRUCTIONS, /items\[\]\.test/);
  assert.match(MCP_INSTRUCTIONS, /address\.city/);
  assert.match(MCP_INSTRUCTIONS, /Gmail \(needs a Google connection/);
  assert.doesNotMatch(MCP_INSTRUCTIONS, /page queries \{ view \}/);
});

test("upsert_batch defaults, strict schema, settings and workspace line", async () => {
  const ctx = await owner();
  const call = client(ctx);
  const rawCall = raw(ctx);
  await call("objects.create", {
    slug: "contact",
    name: "Contact",
    fields: [{ key: "email", label: "Email", type: "email", unique: true }],
  });

  const res = await rawCall("records.upsert_batch", {
    object: "contact",
    match: "email",
    test: true,
    items: [{ data: { email: "a@x.io" } }],
  });
  assert.ok(!res.isError, res.content[0]?.text);
  assert.equal(JSON.parse(res.content[0]!.text).length, 1);
  assert.match(res.content.at(-1)!.text, /^workspace: /);

  // Same email with match default: update, not duplicate.
  await call("records.upsert_batch", {
    object: "contact",
    match: "email",
    items: [{ data: { email: "a@x.io" } }],
  });
  const found = await call("records.search", { object: "contact" });
  assert.equal(found.total, 1);

  const bad = await rawCall("records.upsert_batch", {
    object: "contact",
    items: [{ email: "b@x.io" }],
  });
  assert.equal(bad.isError, true);

  const csv = await call("records.import_csv", {
    object: "contact",
    csv: "email\nc@x.io",
    mapping: { email: "email" },
    test: true,
  });
  assert.equal(csv.created, 1);

  const settings = await call("workspace.settings");
  assert.deepEqual(settings.allowedDomains, []);

  const read = await rawCall("workspace.settings");
  assert.equal(read.content.length, 1);

  const badName = await rawCall("functions.get", { name: "Score_Lead" });
  assert.equal(badName.isError, true);
  assert.match(badName.content[0]!.text, /kebab-case/);
});
