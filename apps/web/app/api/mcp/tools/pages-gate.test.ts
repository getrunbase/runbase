// Publish gate of page.publish / page.update (no database, no renderer).
import { test } from "node:test";
import assert from "node:assert/strict";
import { publishBlock, RENDER_NOT_CHECKED } from "./pages";

const shot = {
  viewport: "desktop",
  theme: "light",
  png: Buffer.alloc(0),
} as const;

test("publish gate: rendered-or-force", () => {
  // Renderer down: nothing was rendered, the reason says so plainly.
  assert.equal(
    publishBlock({ shots: [], errors: [], pageErrors: [] }),
    RENDER_NOT_CHECKED,
  );
  assert.match(RENDER_NOT_CHECKED, /platform outage/);
  assert.match(
    publishBlock({ shots: [shot], errors: ["boom"], pageErrors: [{}] })!,
    /2 error/,
  );
  assert.equal(
    publishBlock({ shots: [shot], errors: [], pageErrors: [] }),
    null,
  );
});
