import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cellText,
  columnsFromFields,
  columnsOf,
  initials,
  nextSort,
  parseSort,
  tableView,
  toQuerySort,
} from "./table";

const rows = [
  { name: "Ada", data: { amount: 30 }, won: true },
  { name: "bob", data: { amount: 5 }, won: false },
  { name: "Cy", data: { amount: null }, won: true },
];
const cols = columnsOf(
  ["name", { key: "data.amount", label: "Amount", type: "currency" }],
  rows[0],
);
const en = { locale: "en-US" };

test("columnsOf: strings, typed objects, default = keys", () => {
  assert.deepEqual(cols, [
    { key: "name", label: "Name", type: "text" },
    { key: "data.amount", label: "Amount", type: "currency" },
  ]);
  assert.deepEqual(columnsOf(undefined, { a: 1 }).map((c) => c.key), ["a"]);
});

test("columnsFromFields: typed columns from the object schema", () => {
  const fields = [
    { key: "name", label: "Name", type: "text" },
    { key: "stage", label: "Stage", type: "select", options: ["a"] },
    { key: "amount", type: "currency", currency: "USD" },
    { key: "meta", type: "json" },
  ];
  assert.deepEqual(columnsFromFields(fields), [
    { key: "data.name", label: "Name", type: "text" },
    { key: "data.stage", label: "Stage", type: "badge" },
    { key: "data.amount", label: "Amount", type: "currency", format: "USD" },
  ]);
  assert.deepEqual(
    columnsFromFields(fields, ["amount", "nope", "name"]).map((c) => c.key),
    ["data.amount", "data.name"],
  );
});

test("cellText by type and locale", () => {
  assert.equal(cellText(5, cols[1]!, en), "€5.00");
  assert.equal(cellText(5, cols[1]!, { locale: "fr-FR" }).replace(/\s/g, " "), "5,00 €");
  const b = { key: "w", label: "w", type: "boolean" };
  assert.equal(cellText("false", b, { yesNo: ["Oui", "Non"] }), "Non");
  assert.equal(cellText(true, b, { yesNo: ["Oui", "Non"] }), "Oui");
  assert.equal(cellText("2026-01-02", { key: "d", label: "d", type: "date" }, en), "1/2/26");
  assert.equal(
    cellText(3.14159, { key: "n", label: "n", type: "number", format: "2" }, en),
    "3.14",
  );
  const badge = columnsOf([{ key: "s", type: "badge", map: { paid: { label: "Paid" } } }], {})[0]!;
  assert.equal(cellText("paid", badge), "Paid");
  assert.equal(cellText("other", badge), "other");
  assert.equal(cellText(null, cols[1]!), "");
});

test("tableView: search, sort (empty values last), pagination", () => {
  const names = (v: { rows: Record<string, unknown>[] }) => v.rows.map((r) => r.name);
  assert.deepEqual(names(tableView(rows, cols, { query: "B" })), ["bob"]);
  assert.deepEqual(names(tableView(rows, cols, { ...en, query: "30.00" })), ["Ada"]);
  assert.deepEqual(
    names(tableView(rows, cols, { sort: { key: "data.amount", dir: "asc" } })),
    ["bob", "Ada", "Cy"],
  );
  assert.deepEqual(
    names(tableView(rows, cols, { sort: { key: "name", dir: "desc" } })),
    ["Cy", "bob", "Ada"],
  );
  const p = tableView(rows, cols, { pageSize: 2, page: 5 });
  assert.equal(p.pages, 2);
  assert.equal(p.page, 1);
  assert.deepEqual(names(p), ["Cy"]);
});

test("sort: asc, desc, none; server sort", () => {
  const a = nextSort(null, "x");
  const d = nextSort(a, "x");
  assert.deepEqual([a, d, nextSort(d, "x")], [{ key: "x", dir: "asc" }, { key: "x", dir: "desc" }, null]);
  assert.deepEqual(parseSort("-data.a"), { key: "data.a", dir: "desc" });
  assert.equal(parseSort(""), null);
  assert.deepEqual(toQuerySort({ key: "data.amount", dir: "desc" }), [{ field: "amount", dir: "desc" }]);
  assert.equal(initials("ada lovelace"), "AL");
});
