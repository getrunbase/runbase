// query.sql and workspace.describe: SQL errors enriched with the
// columns of the cited views, described views. Requires DATABASE_URL,
// QUERY_DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner, raw } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

const setup = async () => {
  const ctx = await owner();
  await client(ctx)("objects.create", {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "amount", label: "Amount", type: "number" }],
  });
  return ctx;
};

test("query.sql: uuid = text suggests a cast, missing column lists the columns", async () => {
  const call = raw(await setup());

  const cast = await call("query.sql", {
    sql: "select * from events e join deal d on e.record_id = d.external_id",
  });
  assert.ok(cast.isError);
  const t1 = cast.content[0]!.text;
  assert.match(t1, /^\[error\] operator does not exist: uuid = text/);
  assert.match(t1, /::text/);
  assert.match(t1, /::uuid/);
  assert.match(t1, /Columns of events\(id uuid, type text, record_id uuid/);
  assert.match(t1, /Columns of deal\(id uuid, external_id text, amount text/);

  const col = await call("query.sql", { sql: "select amout from deal" });
  assert.ok(col.isError);
  const t2 = col.content[0]!.text;
  assert.match(t2, /column "amout" does not exist/);
  assert.match(t2, /Columns of deal\(id uuid, external_id text, amount text, created_at/);
  // Never the internal SQL of the views nor another workspace's view.
  assert.doesNotMatch(t1 + t2, /query\.records|create temp view|data->>/);
});

test("workspace.describe: SQL views with columns and types", async () => {
  const ctx = await setup();
  const other = await owner();
  await client(other)("objects.create", {
    slug: "secret_thing",
    name: "S",
    fields: [{ key: "x", label: "X", type: "text" }],
  });
  const { sqlViews } = await client(ctx)("workspace.describe");
  const names = sqlViews.map((v: { name: string }) => v.name);
  assert.ok(names.includes("events") && names.includes("records"));
  assert.ok(names.includes("deal"));
  assert.ok(!names.includes("secret_thing"));
  const events = sqlViews.find((v: { name: string }) => v.name === "events");
  assert.deepEqual(events.columns.slice(0, 3), [
    { name: "id", type: "uuid" },
    { name: "type", type: "text" },
    { name: "record_id", type: "uuid" },
  ]);
});
