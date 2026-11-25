import { test } from "node:test";
import assert from "node:assert/strict";
import { byteUnit, usagePercent } from "./format";

test("usagePercent: null when unlimited, capped at 100", () => {
  assert.equal(usagePercent(5, null), null);
  assert.equal(usagePercent(25, 100), 25);
  assert.equal(usagePercent(300, 100), 100);
  assert.equal(usagePercent(0, 0), 100);
});

test("byteUnit picks the largest unit", () => {
  assert.deepEqual(byteUnit(0), { unit: "byte", n: 0 });
  assert.deepEqual(byteUnit(1500), { unit: "kilobyte", n: 1.5 });
  assert.deepEqual(byteUnit(2_000_000_000), { unit: "gigabyte", n: 2 });
});
