// Acceptance test: CRM database and its objects created through MCP.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner, raw } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

test("database CRM via MCP", async () => {
  const ctx = await owner();
  const call = client(ctx);
  await call("databases.create", { slug: "crm", name: "CRM" });
  for (const [slug, name] of [
    ["contact", "Contacts"],
    ["company", "Entreprises"],
    ["deal", "Deals"],
  ])
    await call("objects.create", {
      slug,
      name,
      database: "crm",
      fields: [{ key: "name", label: "Nom", type: "text" }],
    });
  const crm = await call("databases.get", { database: "crm" });
  assert.equal(crm.objects.length, 3);
  await call("databases.rename", { database: "crm", name: "Ventes" });
  assert.equal((await call("databases.list"))[0].name, "Ventes");

  const refused = await raw(ctx)("databases.delete", { database: "crm" });
  assert.equal(refused.isError, true);
  await call("databases.delete", { database: "crm", confirm: true });
  assert.equal((await call("objects.list")).length, 0);
});
