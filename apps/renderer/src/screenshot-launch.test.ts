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

test("CHROMIUM_SANDBOX=false: --no-sandbox even as non-root", () => {
  const o = launchOptions(1000, false);
  assert.equal(o.chromiumSandbox, false);
  assert.ok(o.args.includes("--no-sandbox"));
});

test("non-root: OS sandbox kept", () => {
  const o = launchOptions(1000, true);
  assert.equal(o.chromiumSandbox, true);
  assert.ok(!o.args.includes("--no-sandbox"));
});
