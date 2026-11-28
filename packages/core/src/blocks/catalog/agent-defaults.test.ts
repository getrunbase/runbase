// Agent-facing defaults of the data and formatter blocks: pure, no database.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { blocks, type BlockContext } from "../index";
import { dropEmpty } from "./record-data";

after(() => setImmediate(() => process.exit(0)));

const base = {
  settings: async () => ({}) as never,
  depth: 0,
  signal: new AbortController().signal,
};

test("dropEmpty removes empty-rendered values only when asked", () => {
  const d = { a: "", b: null, c: "  ", d: 0, e: false, f: "x" };
  assert.deepEqual(dropEmpty(d, true), { d: 0, e: false, f: "x" });
  assert.deepEqual(dropEmpty(d, false), d);
});

test("record.upsert skips empty values by default, record.update does not", async () => {
  const calls: unknown[] = [];
  const services = {
    objects: { get: async () => ({ id: "obj" }) },
    records: {
      upsert: async (a: { data: unknown }) => {
        calls.push(a.data);
        return { record: {}, created: false, changed: [] };
      },
      update: async (_id: string, data: unknown) => {
        calls.push(data);
        return { record: {}, changed: [] };
      },
    },
  } as unknown as BlockContext["services"];
  const ctx = { ...base, services } as BlockContext;
  const up = blocks["record.upsert"]!;
  await up.run(
    up.inputSchema.parse({
      object: "contact",
      match: "email",
      data: { email: "a@x.io", phone: "" },
    }),
    ctx,
  );
  const upd = blocks["record.update"]!;
  await upd.run(
    upd.inputSchema.parse({ recordId: "r", data: { phone: "" } }),
    ctx,
  );
  await upd.run(
    upd.inputSchema.parse({
      recordId: "r",
      data: { phone: "" },
      skipEmpty: true,
    }),
    ctx,
  );
  assert.deepEqual(calls, [{ email: "a@x.io" }, { phone: "" }, {}]);
});

test("number.math names a null operand", async () => {
  const b = blocks.formatter!;
  const ctx = {
    ...base,
    services: {} as BlockContext["services"],
  } as BlockContext;
  for (const input of [
    { op: "number.math", input: null, operator: "+", operand: 1 },
    { op: "number.math", input: 2, operator: "*", operand: "" },
  ])
    await assert.rejects(b.run(b.inputSchema.parse(input), ctx), (e: Error) => {
      assert.match(e.message, /is null/);
      return true;
    });
});
