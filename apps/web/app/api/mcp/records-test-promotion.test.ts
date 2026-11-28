// Test-record promotion is visible, filter errors are invalid_input, and
// objects.migrate exposes the core MigrateOp (map, caseInsensitive,
// update). Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner } from "./test-client";
import { migrateOperation, migrateParity } from "./tools/records";

after(() => setImmediate(() => process.exit(0)));

test("migrate schema matches the core MigrateOp", () => {
  assert.equal(migrateParity, true);
  const ops = migrateOperation.options.map((o) => o.shape.op.value).sort();
  assert.deepEqual(ops, [
    "add",
    "change_type",
    "delete",
    "rename",
    "require",
    "update",
  ]);
});

test("promotion, test flag and filter errors through MCP", async () => {
  const ctx = await owner();
  const call = client(ctx);
  await call("objects.create", {
    slug: "leads",
    name: "Leads",
    fields: [
      { key: "email", label: "Email", type: "email", unique: true },
      { key: "stage", label: "Stage", type: "text" },
      { key: "since", label: "Since", type: "date" },
    ],
  });
  const a = await call("records.upsert", {
    object: "leads",
    match: "email",
    test: true,
    data: { email: "a@x.io", stage: "Won", since: "2026-05-10" },
  });
  await call("records.upsert", {
    object: "leads",
    match: "email",
    test: true,
    data: { email: "b@x.io", stage: "lost", since: "2026-03-10" },
  });

  // test: true keeps it purgeable; a live write promotes with a warning.
  const kept = await call("records.update", {
    id: a.record.id,
    data: { stage: "won" },
    test: true,
  });
  assert.equal(kept.promoted, false);
  assert.equal(kept.warning, undefined);
  const live = await call("records.update", {
    id: a.record.id,
    data: { stage: "Won" },
  });
  assert.equal(live.promoted, true);
  assert.match(live.warning, /test:true/);

  // between on a date field.
  const found = await call("records.search", {
    object: "leads",
    filter: {
      field: "since",
      op: "between",
      value: ["2026-05-01", "2026-05-31"],
    },
  });
  assert.deepEqual(
    found.records.map((r: { id: string }) => r.id),
    [a.record.id],
  );

  // update_where with test: true leaves the test record purgeable.
  const filter = { field: "email", op: "eq", value: "b@x.io" };
  await call("records.update_where", {
    object: "leads",
    filter,
    data: { stage: "lost" },
    dryRun: true,
  });
  const bulk = await call("records.update_where", {
    object: "leads",
    filter,
    data: { stage: "Lost" },
    expected: 1,
    test: true,
  });
  assert.equal(bulk.promoted, undefined);
  const dry = await call("workspace.purge_test", { dryRun: true });
  assert.equal(dry.records, 1);

  // Invalid regex: invalid_input naming the pattern and the dialect.
  await assert.rejects(
    call("records.search", {
      object: "leads",
      filter: { field: "stage", op: "regex", value: "(" },
    }),
    /\[invalid_input\].*"\(".*POSIX/,
  );

  // change_type with map + caseInsensitive, then op update.
  await call("objects.migrate", {
    object: "leads",
    operation: {
      op: "change_type",
      field: "stage",
      type: "select",
      options: ["won", "lost"],
      caseInsensitive: true,
    },
  });
  await call("objects.migrate", {
    object: "leads",
    operation: { op: "update", field: "stage", label: "Pipeline stage" },
  });
  const schema = await call("objects.get", { object: "leads" });
  const stage = schema.fields.find((f: { key: string }) => f.key === "stage");
  assert.equal(stage.label, "Pipeline stage");
  assert.equal(stage.type, "select");
});
