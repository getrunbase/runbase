import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatMeter, meterPercent } from "./usage-format";

// Intl may use narrow no-break spaces: compare with plain spaces.
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

test("bytes scale to the largest unit, in the user's locale", () => {
  assert.equal(plain(formatBytes(0, "en")), "0 byte");
  assert.equal(plain(formatBytes(1500, "en")), "1.5 kB");
  assert.equal(plain(formatBytes(2_500_000_000, "fr")), "2,5 Go");
  assert.equal(plain(formatBytes(-5, "en")), "0 byte");
});

test("counts group thousands and AI spending is in USD", () => {
  assert.equal(plain(formatMeter("records", 1234567, "en")), "1,234,567");
  assert.equal(plain(formatMeter("records", 1234567, "fr")), "1 234 567");
  assert.equal(plain(formatMeter("aiBudgetUsd", 1.5, "en")), "$1.50");
  assert.equal(plain(formatMeter("aiBudgetUsd", 1.5, "fr")), "1,50 $US");
});

test("fill: unlimited is empty, zero limit is full, capped at 100", () => {
  assert.equal(meterPercent(5, null), 0);
  assert.equal(meterPercent(0, 0), 100);
  assert.equal(meterPercent(25, 100), 25);
  assert.equal(meterPercent(300, 100), 100);
});
