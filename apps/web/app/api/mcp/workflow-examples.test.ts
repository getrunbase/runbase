// Done-when check: an agent reads workflows.guide and workflows.examples,
// creates each example through MCP and workflows.validate accepts it.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

test("every workflow example is created through MCP and validates", async () => {
  const call = client(await owner());
  assert.match((await call("workflows.guide")).guide, /One function = one job/);
  const { items } = await call("workflows.examples");
  assert.ok(items.length >= 2);

  for (const { name } of items) {
    const ex = await call("workflows.examples", { name });
    for (const s of ex.secrets)
      await call("secrets.set", { name: s, value: "test-value" });
    for (const o of ex.objects) await call("objects.create", o);
    for (const w of ex.webhooks) await call("webhooks.create", w);
    for (const f of ex.functions) await call("functions.save", f);
    const definition = ex.workflow.definition;
    assert.deepEqual(
      await call("workflows.validate", { definition }),
      { errors: [], warnings: [] },
      name,
    );
    const wf = await call("workflows.create", {
      name: ex.workflow.name,
      definition,
    });
    assert.equal(wf.status, "draft");
  }
});
