import assert from "node:assert/strict";
import { test } from "node:test";
import { translator } from "@/lib/i18n-test";
import { summarize as sum } from "./json-view";

const t = translator("fr", "common");
const summarize = (v: unknown) => sum(v, t);

test("summarize: readable summary of a JSON value", () => {
  assert.equal(summarize(null), "vide");
  assert.equal(summarize({}), "vide");
  assert.equal(summarize([1, 2]), "2 éléments");
  assert.equal(summarize({ a: 1, b: 2 }), "a, b");
  assert.equal(
    summarize({ a: 1, b: 2, c: 3, d: 4, e: 5 }),
    "a, b, c, d… (5 champs)",
  );
  assert.equal(summarize("x".repeat(70)), "x".repeat(60) + "…");
});

test("summarize: English", () => {
  assert.equal(sum([1], translator("en", "common")), "1 item");
});
