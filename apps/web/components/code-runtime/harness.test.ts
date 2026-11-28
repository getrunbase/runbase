import { test } from "node:test";
import assert from "node:assert/strict";
import render, { stripTmpPaths } from "./harness";

test("stripTmpPaths hides sandbox temp paths", () => {
  assert.equal(
    stripTmpPaths(
      "Error: x\n    at C (file:///tmp/deno-123/bundle.js:4:2)\n    at /private/var/folders/ab/T/x.js:1:1",
    ),
    "Error: x\n    at C (<bundle>:4:2)\n    at <bundle>:1:1",
  );
});

test("missing default export: English message, no temp path", () => {
  const r = render({ bundle: "var __C = {};", props: {}, data: {} });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0]!.text, /has no default export/);
  assert.doesNotMatch(r.errors[0]!.text, /\/tmp\/|manquant/);
});
