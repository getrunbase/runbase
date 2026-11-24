import { test } from "node:test";
import assert from "node:assert/strict";
import { foldAccents, slugify } from "./slug";

test("foldAccents lowercases and strips diacritics", () => {
  assert.equal(foldAccents("Crème Brûlée"), "creme brulee");
});

test("slugify uses underscores by default and trims separators", () => {
  assert.equal(slugify("  Prix du cornet (€) "), "prix_du_cornet");
  assert.equal(slugify("Sauce préférée"), "sauce_preferee");
});

test("slugify supports dashes", () => {
  assert.equal(slugify("Hello, World!", { separator: "-" }), "hello-world");
});

test("slugify returns the fallback when empty", () => {
  assert.equal(slugify("!!!", { fallback: "workflow" }), "workflow");
  assert.equal(slugify("!!!"), "");
});

test("slugify can force a leading letter", () => {
  assert.equal(slugify("2024 revenue", { startWithLetter: true }), "revenue");
  assert.equal(slugify("2024 revenue"), "2024_revenue");
});
