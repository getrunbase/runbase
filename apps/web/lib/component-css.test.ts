// Tailwind CSS compiled per component (app theme).
import { test } from "node:test";
import assert from "node:assert/strict";
import { componentCss } from "./component-css";

test("arbitrary classes, variants and theme tokens; nothing else", async () => {
  const css = await componentCss([
    `<div className="bg-[#0f0] grid-cols-[1fr_2fr] dark:bg-primary hover:underline" />`,
  ]);
  assert.match(css, /\.bg-\\\[\\#0f0\\\]/);
  assert.match(css, /grid-template-columns: 1fr 2fr/);
  assert.match(css, /\.dark\\:bg-primary:is\(\.dark \*\)/);
  assert.match(css, /background-color: var\(--primary\)/);
  assert.match(css, /hover\\:underline:hover/);
  assert.doesNotMatch(css, /\.text-red-500/);
  assert.doesNotMatch(css, /\.p-4\b/);
});
