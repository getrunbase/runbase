// notes.* and workspace.describe: an agent reads, edits and deletes
// workspace notes through MCP. Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner, raw } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

test("notes: save, describe titles, get, edit, delete through MCP", async () => {
  const ctx = await owner();
  const call = client(ctx);
  await call("objects.create", {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "amount", label: "Amount", type: "number" }],
  });
  const note = await call("notes.save", {
    entity: { type: "object", ref: "deal" },
    title: "Amounts",
    body: "Amounts are in cents.",
  });
  assert.equal(note.stale, false);

  const d = await call("workspace.describe");
  const deal = d.databases
    .flatMap((db: { objects: { slug: string }[] }) => db.objects)
    .find((o: { slug: string }) => o.slug === "deal");
  assert.deepEqual(deal.notes, [
    { id: note.id, title: "Amounts", stale: false },
  ]);
  assert.deepEqual(d.notes, []);

  const edited = await call("notes.save", {
    entity: { type: "object", ref: "deal" },
    title: "Amounts",
    body: "Amounts are in euros.",
  });
  assert.equal(edited.id, note.id);
  assert.equal(
    (await call("notes.get", { id: note.id })).body,
    "Amounts are in euros.",
  );
  assert.equal((await call("notes.list")).length, 1);

  assert.equal(await call("notes.delete", { id: note.id }), true);
  const missing = await raw(ctx)("notes.get", { id: note.id });
  assert.ok(missing.isError);
  assert.match(missing.content[0]!.text, /^\[not_found\] Note not found/);
});
