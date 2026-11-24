// Container smoke render: one page, real Chromium (skipped without a browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserAvailable } from "./screenshot";
import { renderSmoke } from "./smoke";

test("renders the smoke page and takes a screenshot", async (t) => {
  if (!(await browserAvailable())) return t.skip("no Chromium");
  const r = await renderSmoke();
  assert.equal(r.text, "renderer smoke");
  assert.ok(r.bytes > 100);
});
