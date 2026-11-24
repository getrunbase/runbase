import { test } from "node:test";
import assert from "node:assert/strict";
import { evalFormula, formulaRefs, parseFormula } from "./formula";

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
