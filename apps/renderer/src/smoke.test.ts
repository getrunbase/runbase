// Container smoke render: one page, real Chromium (skipped without a browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserAvailable } from "./screenshot";
import { renderSmoke } from "./smoke";

test("renders the smoke page and takes a screenshot", async (t) => {
  // Chromium tests run only in CI (or with RENDERER_BROWSER_TESTS=1): they hang on dev machines.
  if (!process.env.CI && !process.env.RENDERER_BROWSER_TESTS) return t.skip("browser tests run in CI only");
  if (!(await browserAvailable())) return t.skip("no Chromium");
  const r = await renderSmoke();
  assert.equal(r.text, "renderer smoke");
  assert.ok(r.bytes > 100);
});
