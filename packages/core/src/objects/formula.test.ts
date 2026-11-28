import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evalFormula,
  formulaRefs,
  parseFormula,
  renameFormulaRef,
} from "./formula";

test("formula: renameFormulaRef rewrites identifiers only", () => {
  assert.equal(
    renameFormulaRef(
      'amount * qty + len("amount") + round(amount)',
      "amount",
      "total",
    ),
    'total * qty + len("amount") + round(total)',
  );
  assert.equal(renameFormulaRef("round(x)", "round", "r"), "round(x)");
  assert.equal(
    renameFormulaRef("amounts + amount", "amount", "a"),
    "amounts + a",
  );
});

test("formula: arithmetic, precedence, concatenation and functions", () => {
  const d = { price: 10, qte: 3, name: "Acme", remise: null };
  assert.equal(evalFormula("price * qte + 1", d), 31);
  assert.equal(evalFormula("(price + 2) * 2", d), 24);
  assert.equal(evalFormula('name + " (" + qte + ")"', d), "Acme (3)");
  assert.equal(evalFormula('if(qte > 2, "gros", "petit")', d), "gros");
  assert.equal(evalFormula("round(price / 3, 2)", d), 3.33);
  assert.equal(evalFormula("coalesce(remise, 0)", d), 0);
  assert.equal(evalFormula("price > 5 and not (qte = 0)", d), true);
  assert.equal(evalFormula("-price", d), -10);
});

test("formula: missing values and errors -> null, never an exception", () => {
  assert.equal(evalFormula("price * qte", {}), null);
  assert.equal(evalFormula("price / 0", { price: 4 }), null);
  assert.equal(evalFormula("name * 2", { name: "x" }), null);
});

test("formula: no access outside the record (no eval)", () => {
  assert.throws(() => parseFormula("process.exit(1)"));
  assert.throws(() => parseFormula("constructor()"));
  assert.equal(evalFormula("constructor", {}), null);
  assert.throws(() => parseFormula("1 +"));
  assert.deepEqual(formulaRefs("price * qte + round(rate)").sort(), [
    "price",
    "qte",
    "rate",
  ]);
});

test("formula: days_between compares calendar dates (b - a), now()", () => {
  const db = (a: unknown, b: unknown) =>
    evalFormula("days_between(a, b)", { a, b });
  assert.equal(db("2024-01-01", "2024-01-31"), 30);
  assert.equal(db("2024-01-31", "2024-01-01"), -30);
  // Time of day ignored: late evening to next morning = 1 day.
  assert.equal(db("2024-03-10T23:30:00Z", "2024-03-11T00:15:00Z"), 1);
  assert.equal(db("2024-03-10T08:00:00Z", "2024-03-10T22:00:00Z"), 0);
  assert.equal(db("2024-03-10", "2024-03-10T18:00:00Z"), 0);
  assert.equal(db("nope", "2024-01-01"), null);
  assert.equal(db(null, "2024-01-01"), null);
  const now = evalFormula("now()", {}) as string;
  assert.match(now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.equal(evalFormula("days_between(today(), now())", {}), 0);
});
