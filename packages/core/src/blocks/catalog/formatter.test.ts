// Formatter block: pure, case table per operation.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { blocks, type BlockContext } from "../index";

after(() => setImmediate(() => process.exit(0)));

const ctx = {
  services: {} as BlockContext["services"],
  settings: async () => ({}) as never,
  depth: 0,
  signal: new AbortController().signal,
} as BlockContext;
const run = async (input: object) => {
  const b = blocks.formatter!;
  return (
    (await b.run(b.inputSchema.parse(input), ctx)).output as { value: unknown }
  ).value;
};

const D = "2026-03-31T22:30:00Z";
const cases: [string, object, unknown][] = [
  ["text.upper", { input: "abc" }, "ABC"],
  ["text.upper", { input: null }, ""],
  ["text.lower", { input: "ÀBC" }, "àbc"],
  ["text.capitalize", { input: "jean-pierre DUPONT" }, "Jean-Pierre Dupont"],
  ["text.trim", { input: "  a b  " }, "a b"],
  ["text.replace", { input: "a-b-c", find: "-", replace: "+" }, "a+b+c"],
  ["text.split", { input: "a,b,c" }, ["a", "b", "c"]],
  ["text.split", { input: "a b c", separator: " ", index: -1 }, "c"],
  ["text.split", { input: "a", index: 5 }, null],
  ["text.truncate", { input: "abcdef", length: 3 }, "abc"],
  [
    "text.extract_email",
    { input: "Contact: Bob <bob.s+x@mail.co.uk>." },
    "bob.s+x@mail.co.uk",
  ],
  ["text.extract_email", { input: "rien" }, null],
  [
    "text.extract_url",
    { input: "voir https://x.io/a?b=1, merci" },
    "https://x.io/a?b=1",
  ],
  ["text.extract_number", { input: "Total : 1 234,50 €" }, 1234.5],
  ["text.extract_number", { input: "aucun" }, null],
  ["text.slugify", { input: "Éléphant & Café !" }, "elephant-cafe"],
  ["text.default", { input: "  ", value: "n/a" }, "n/a"],
  ["text.default", { input: "x", value: "n/a" }, "x"],
  ["number.parse", { input: "1,234.5" }, 1234.5],
  ["number.parse", { input: "1.234,5" }, 1234.5],
  ["number.parse", { input: "$12" }, 12],
  ["number.parse", { input: "" }, null],
  [
    "number.format",
    { input: 1234.5, locale: "en-US", decimals: 2 },
    "1,234.50",
  ],
  [
    "number.format",
    { input: "12", locale: "en-US", currency: "EUR" },
    "€12.00",
  ],
  ["number.round", { input: 2.345, decimals: 2 }, 2.35],
  ["number.math", { input: "10", operator: "*", operand: 3 }, 30],
  ["number.math", { input: 10, operator: "/", operand: "4" }, 2.5],
  ["date.parse", { input: "2026-03-31" }, "2026-03-31T00:00:00.000Z"],
  ["date.format", { input: D }, "2026-03-31T22:30:00.000Z"],
  [
    "date.format",
    { input: D, format: "date", locale: "en-US", timezone: "Europe/Paris" },
    "Apr 1, 2026",
  ],
  [
    "date.format",
    { input: D, format: "DD/MM/YYYY HH:mm", timezone: "Europe/Paris" },
    "01/04/2026 00:30",
  ],
  ["date.format", { input: "" }, null],
  [
    "date.add",
    { input: D, amount: 2, unit: "days" },
    "2026-04-02T22:30:00.000Z",
  ],
  ["date.diff", { input: D, other: "2026-04-14T22:30:00Z", unit: "weeks" }, 2],
  ["utility.lookup", { input: "fr", table: { fr: "France" } }, "France"],
  [
    "utility.lookup",
    { input: "xx", table: { fr: "France" }, fallback: "?" },
    "?",
  ],
  ["utility.lookup", { input: "toString", table: {} }, null],
  ["utility.pick_first", { input: [null, "", " ", "a", "b"] }, "a"],
  ["utility.pick_first", { input: [] }, null],
  ["utility.to_list", { input: "a, b,,c" }, ["a", "b", "c"]],
  ["utility.join", { input: ["a", "", null, "b"], separator: " / " }, "a / b"],
];

test("formatter: each operation", async () => {
  for (const [op, params, expected] of cases)
    assert.deepEqual(
      await run({ op, ...params }),
      expected,
      `${op} ${JSON.stringify(params)}`,
    );
});

test("formatter: invalid inputs", async () => {
  for (const i of [
    { op: "number.parse", input: "abc" },
    { op: "number.math", input: 1, operator: "/", operand: 0 },
    { op: "date.parse", input: "pas une date" },
  ])
    await assert.rejects(
      run(i),
      (e: Error & { code?: string }) =>
        e.code === "blocks.formatterInvalid" || /invalid input/.test(e.message),
    );
  assert.throws(() =>
    blocks.formatter!.inputSchema.parse({ op: "nope", input: 1 }),
  );
});
