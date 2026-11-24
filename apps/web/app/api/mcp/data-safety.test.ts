// Data safety through MCP: trash, history, operations by
// filter, CSV import and export, schema migration. Requires DATABASE_URL
// and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner, raw } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

test("data protected end to end through MCP", async () => {
  const ctx = await owner();
  const call = client(ctx);
  await call("objects.create", {
    slug: "contacts",
    name: "Contacts",
    fields: [
      { key: "name", label: "Nom", type: "text" },
      { key: "email", label: "Email", type: "email", unique: true },
      { key: "score", label: "Score", type: "text" },
    ],
  });
  const report = await call("records.import_csv", {
    object: "contacts",
    csv: "nom,mail,score\nAda,ada@x.io,10\nBob,bob@x.io,20\nAda 2,ada@x.io,30",
    mapping: { nom: "name", mail: "email", score: "score" },
    match: "email",
  });
  assert.equal(report.created, 2);
  assert.equal(report.updated, 1);

  const page = await call("objects.export", { object: "contacts" });
  assert.equal(page.next, null);
  assert.equal(page.csv.trim().split("\n").length, 3);

  const preview = await call("objects.migrate", {
    object: "contacts",
    operation: { op: "change_type", field: "score", type: "number" },
    dryRun: true,
  });
  assert.equal(preview.invalid, 0);
  await call("objects.migrate", {
    object: "contacts",
    operation: { op: "change_type", field: "score", type: "number" },
  });

  const {
    records: [bob],
  } = await call("records.search", {
    object: "contacts",
    q: "Bob",
  });
  assert.equal(bob.data.score, 20);
  await call("records.update", { id: bob.id, data: { score: 25 } });
  const history = await call("records.history", { id: bob.id });
  await call("records.revert", { id: bob.id, auditId: history[0].id });

  const filter = { all: [{ field: "score", op: "gte", value: 20 }] };
  const dry = await call("records.delete_where", {
    object: "contacts",
    filter,
    dryRun: true,
  });
  assert.equal(dry.count, 2);
  const refused = await raw(ctx)("records.delete_where", {
    object: "contacts",
    filter,
  });
  assert.equal(refused.isError, true);
  await call("records.delete_where", {
    object: "contacts",
    filter,
    expected: 2,
  });
  assert.equal(
    (await call("records.search", { object: "contacts" })).records.length,
    0,
  );
  const trash = await call("records.trash", { object: "contacts" });
  assert.equal(trash.length, 2);
  await call("records.restore", { id: bob.id });
  assert.equal(
    (await call("records.search", { object: "contacts" })).records.length,
    1,
  );
  assert.deepEqual(
    await call("records.purge", { object: "contacts", confirm: true }),
    {
      purged: 1,
    },
  );

  const objRefused = await raw(ctx)("objects.delete", { object: "contacts" });
  assert.equal(objRefused.isError, true);
});
