// Acceptance test: object, leads and events created then read back through MCP.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

test("object, leads and events entirely through MCP", async () => {
  const call = client(await owner());

  await call("objects.create", {
    slug: "lead",
    name: "Lead",
    fields: [
      { key: "email", label: "Email", type: "email", required: true },
      { key: "score", label: "Score", type: "number" },
    ],
  });
  assert.equal((await call("objects.get", { object: "lead" })).slug, "lead");
  assert.equal((await call("objects.list")).length, 1);

  const batch = await call("records.upsert_batch", {
    object: "lead",
    items: [
      { externalId: "a", data: { email: "a@x.io", score: 10 } },
      { externalId: "b", data: { email: "b@x.io", score: 90 } },
    ],
  });
  assert.equal(batch.length, 2);
  const one = await call("records.upsert", {
    object: "lead",
    externalId: "c",
    data: { email: "c@x.io", score: 50 },
  });
  const id = one.record.id;

  await call("records.update", { id, data: { score: 70 } });
  assert.equal((await call("records.get", { id })).data.score, 70);

  await call("events.push", {
    recordId: id,
    type: "email.opened",
    payload: { n: 1 },
  });
  await call("events.push", { recordId: id, type: "email.clicked" });
  const { items: events, hasMore } = await call("events.list", {
    recordId: id,
  });
  assert.equal(hasMore, false);
  assert.deepEqual(
    events
      .map((e: { type: string }) => e.type)
      .filter((t: string) => !t.startsWith("record.")),
    ["email.opened", "email.clicked"],
  );

  const { records: hot, total } = await call("records.search", {
    object: "lead",
    filter: { all: [{ field: "score", op: "gte", value: 60 }] },
    sort: [{ field: "score", dir: "desc" }],
  });
  assert.equal(total, hot.length);
  assert.deepEqual(
    hot.map((r: { externalId: string }) => r.externalId),
    ["b", "c"],
  );

  await call("records.delete", { id });
  assert.equal((await call("records.search", { object: "lead" })).records.length, 2);

  await call("objects.update_schema", {
    object: "lead",
    fields: [{ key: "email", label: "Email", type: "email", required: true }],
  });
  assert.equal(
    (await call("objects.get", { object: "lead" })).fields.length,
    1,
  );
  await call("objects.delete", { object: "lead", confirm: true });
  assert.equal((await call("objects.list")).length, 0);

  await call("workspaces.create", { name: "Second" });
  assert.equal((await call("workspaces.list")).length, 2);
});

test("functions: create, update, restore through MCP", async () => {
  const call = client(await owner());
  await call("functions.save", { name: "f", code: "v1" });
  assert.equal(
    (await call("functions.save", { name: "f", code: "v2" })).version,
    2,
  );
  assert.equal(
    (await call("functions.restore", { name: "f", version: 1 })).version,
    3,
  );
  assert.equal((await call("functions.get", { name: "f" })).code, "v1");
  assert.equal(
    (await call("functions.get", { name: "f", version: 2 })).code,
    "v2",
  );
  assert.equal((await call("functions.versions", { name: "f" })).length, 3);
  assert.equal((await call("functions.list")).length, 1);
});
