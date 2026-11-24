// Acceptance test: template.export then template.import through MCP.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner, raw } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

test("template.export -> template.import, erreurs lisibles", async () => {
  const src = await owner();
  const call = client(src);
  await call("objects.create", {
    slug: "leads",
    name: "Leads",
    fields: [{ key: "email", label: "Email", type: "email", unique: true }],
  });
  await call("records.upsert", {
    object: "leads",
    data: { email: "a@b.io" },
  });
  await call("secrets.set", { name: "API_KEY", value: "never-exported" });
  const template = await call("template.export", {
    name: "Leads",
    sampleRecords: 5,
  });
  assert.equal(template.format, "runbase-template");
  assert.ok(!JSON.stringify(template).includes("never-exported"));

  const dst = await owner();
  const imported = await client(dst)("template.import", {
    template: JSON.stringify(template),
  });
  assert.equal(imported.objects, 1);
  assert.equal(imported.records, 1);
  assert.deepEqual(
    await client(dst)("template.export", { name: "Leads", sampleRecords: 5 }),
    template,
  );

  const bad = await raw(dst)("template.import", {
    template: { format: "runbase-template", version: 9, name: "X" },
  });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0]!.text, /Invalid template[\s\S]*version/);
});
