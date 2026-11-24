import { test } from "node:test";
import assert from "node:assert/strict";
import { warnFailOpen } from "./request-limits";

test("fail-open warning: at most one per minute", () => {
  const calls: unknown[] = [];
  const log = { warn: (...a: unknown[]) => void calls.push(a) } as never;
  const t0 = 1_000_000_000;
  assert.equal(warnFailOpen(new Error("down"), t0, log), true);
  assert.equal(warnFailOpen(new Error("down"), t0 + 30_000, log), false);
  assert.equal(warnFailOpen(new Error("down"), t0 + 60_000, log), true);
  assert.equal(calls.length, 2);
});
