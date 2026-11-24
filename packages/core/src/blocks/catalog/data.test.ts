// Pure blocks (data, lists, dates, loop): unit tests,
// no database.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { blocks, render, StopError, type BlockContext } from "../index";
import { formatDate } from "./data";

test("formatDate: lowercase tokens, 12h, literals, invalid pattern refused", () => {
  const d = new Date("2026-03-05T14:07:09Z");
  assert.equal(formatDate(d, "dd/MM/yyyy"), "05/03/2026");
  assert.equal(formatDate(d, "d/M/yy H:m:s"), "5/3/26 14:7:9");
  assert.equal(formatDate(d, "hh:mm a"), "02:07 PM");
  assert.equal(formatDate(d, "[Le] dd 'at' HH"), "Le 05 at 14");
  assert.throws(
    () => formatDate(d, "dd/MM/yyyy Q"),
    (e: Error & { code?: string }) => e.code === "blocks.dateFormatInvalid",
  );
  assert.throws(() => formatDate(d, "EEEE dd"));
  assert.throws(() => formatDate(d, "dd MMM yyyy"));
  assert.equal(formatDate(d, "YYYY-MM-DDTHH:mm:ssZ"), "2026-03-05T14:07:09Z");
});

after(() => setImmediate(() => process.exit(0)));

// Tenant-free engine: static registry, inputs rendered against the scope.
const engine: BlockContext["engine"] = {
  getBlock: async (type) => blocks[type],
  stepInput: async (input, raw, scope) =>
    Object.fromEntries(
      Object.entries((input ?? {}) as Record<string, unknown>).map(([k, v]) => [
        k,
        raw.has(k) ? v : render(v, scope),
      ]),
    ),
  startWorkflow: async () => null,
};
const ctx = (extra: Partial<BlockContext> = {}): BlockContext => ({
  services: {} as BlockContext["services"],
  settings: async () => ({}) as never,
  depth: 0,
  signal: new AbortController().signal,
  engine,
  ...extra,
});
const run = async (type: string, input: unknown, c = ctx()) => {
  const b = blocks[type]!;
  return b.run(b.inputSchema.parse(input), c);
};

test("data.set and data.transform", async () => {
  assert.deepEqual((await run("data.set", { values: { a: 1 } })).output, {
    a: 1,
  });
  const r = await run("data.transform", {
    source: { data: { customer: { email: "a@x.io" } }, list: [{ id: 7 }] },
    mapping: { email: "data.customer.email", first: "list.0.id", nope: "z" },
  });
  assert.deepEqual(r.output, { email: "a@x.io", first: 7, nope: null });
});

test("date: format with time zone, add, difference", async () => {
  const d = "2026-03-31T22:30:00Z";
  const v = async (i: object) =>
    ((await run("date", { date: d, ...i })).output as { value: unknown }).value;
  assert.equal(
    await v({
      op: "format",
      format: "DD/MM/YYYY HH:mm",
      timezone: "Europe/Paris",
    }),
    "01/04/2026 00:30",
  );
  assert.equal(await v({ op: "format" }), "2026-03-31");
  assert.equal(
    await v({ op: "add", amount: 2, unit: "days" }),
    "2026-04-02T22:30:00.000Z",
  );
  assert.equal(
    await v({ op: "add", amount: 1, unit: "months" }),
    "2026-05-01T22:30:00.000Z",
  );
  assert.equal(
    await v({ op: "diff", to: "2026-04-14T22:30:00Z", unit: "weeks" }),
    2,
  );
  await assert.rejects(
    run("date", { op: "format", date: "x" }),
    /Invalid date/,
  );
});

test("stop.error: stop error without retry", async () => {
  await assert.rejects(
    run("stop.error", { message: "Negative amount" }),
    (e) => e instanceof StopError && e.message === "Negative amount",
  );
});

test("wait.until: delay until the date, zero if past", async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const r = await run("wait.until", { until: future });
  assert.ok(r.delayMs! > 50_000 && r.delayMs! <= 60_000);
  assert.equal(
    (await run("wait.until", { until: "2020-01-01T00:00:00Z" })).delayMs,
    0,
  );
});

test("lists: aggregate (groups), dedupe, sort, slice", async () => {
  const items = [
    { id: 1, country: "FR", m: 10 },
    { id: 2, country: "BE", m: 5 },
    { id: 3, country: "FR", m: 7 },
    { id: 1, country: "FR", m: 10 },
  ];
  assert.deepEqual(
    (
      await run("list.aggregate", {
        items,
        op: "sum",
        path: "m",
        groupBy: "country",
      })
    ).output,
    {
      value: 32,
      groups: [
        { key: "FR", value: 27 },
        { key: "BE", value: 5 },
      ],
    },
  );
  assert.deepEqual(
    (await run("list.aggregate", { items: [], op: "avg", path: "m" })).output,
    { value: null },
  );
  const d = await run("list.dedupe", { items, path: "id" });
  assert.deepEqual(d.output, { items: items.slice(0, 3), removed: 1 });
  const s = await run("list.sort", {
    items: [{ m: 2 }, {}, { m: 10 }],
    path: "m",
    order: "desc",
  });
  assert.deepEqual(s.output, { items: [{ m: 10 }, { m: 2 }, {}] });
  assert.deepEqual(
    (await run("list.limit", { items: [1, 2, 3, 4], limit: 2, offset: 1 }))
      .output,
    { items: [2, 3], total: 4 },
  );
});

test("record.delete: branch based on existence", async () => {
  const c = ctx({
    services: {
      records: { remove: async (id: string) => (id === "ok" ? { id } : null) },
    } as never,
  });
  assert.equal(
    (await run("record.delete", { recordId: "ok" }, c)).branch,
    "ok",
  );
  assert.equal(
    (await run("record.delete", { recordId: "x" }, c)).branch,
    "not_found",
  );
});

test("loop: run variables (record, event, steps) and raw-input block", async () => {
  const r = await run(
    "loop",
    {
      items: ["a", "b"],
      do: [
        {
          id: "v",
          type: "data.set",
          input: {
            values: {
              s: "{{record.name}}:{{event.k}}:{{item}}:{{index}}:{{steps.before.output.x}}",
            },
          },
        },
        {
          id: "m",
          type: "list.map",
          input: {
            items: ["{{item}}"],
            mapping: { t: { value: "{{item}}!" } },
          },
        },
      ],
    },
    ctx({
      scope: {
        record: { name: "Acme" },
        event: { k: 1 },
        steps: { before: { output: { x: "X" } } },
      },
    }),
  );
  assert.deepEqual((r.output as { results: unknown[] }).results, [
    { v: { s: "Acme:1:a:0:X" }, m: { items: [{ t: "a!" }], truncated: false } },
    { v: { s: "Acme:1:b:1:X" }, m: { items: [{ t: "b!" }], truncated: false } },
  ]);
});

test("loop and workflow.run refuse to run without engine hooks", async () => {
  await assert.rejects(
    run(
      "loop",
      { items: [1], do: [{ id: "a", type: "data.set", input: {} }] },
      ctx({ engine: undefined }),
    ),
    /loop: run context required/,
  );
  await assert.rejects(
    run("workflow.run", { workflow: "x" }, ctx({ engine: undefined })),
    /workflow.run: run context required/,
  );
});

test("workflow.run starts through the injected engine", async () => {
  const calls: unknown[] = [];
  const r = await run(
    "workflow.run",
    { workflow: "child", wait: false },
    ctx({
      tenant: {} as BlockContext["tenant"],
      engine: {
        ...engine!,
        startWorkflow: async (w, o) => {
          calls.push([w, o.depth]);
          return { id: "run1", status: "queued" };
        },
      },
    }),
  );
  assert.deepEqual(calls, [["child", 1]]);
  assert.deepEqual(r.output, { runId: "run1", status: "queued" });
});
