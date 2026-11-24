// Chromium launch options: as root, --no-sandbox (otherwise launch is refused).
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchOptions } from "./screenshot";

test("root: sandbox disabled, --no-sandbox and --disable-dev-shm-usage", () => {
  const o = launchOptions(0);
  assert.equal(o.chromiumSandbox, false);
  assert.ok(o.args.includes("--no-sandbox"));
  assert.ok(o.args.includes("--disable-dev-shm-usage"));
});

test("non-root: OS sandbox kept", () => {
  const o = launchOptions(1000);
  assert.equal(o.chromiumSandbox, true);
  assert.ok(!o.args.includes("--no-sandbox"));
});
