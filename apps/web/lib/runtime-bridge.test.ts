// Runtime iframe bridge: origin filter and SDK call cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "@getrunbase/core/app-error";
import {
  acceptOrigin,
  MAX_CALLS_PER_SEC,
  MAX_WRITES_PER_SEC,
  sdkGuard,
} from "./runtime-bridge";

test("origin: opaque or dedicated runtime accepted, the rest ignored", () => {
  const rt = "http://127.0.0.1:7100";
  assert.ok(acceptOrigin("null", rt));
  assert.ok(acceptOrigin(rt, rt));
  assert.ok(!acceptOrigin("http://localhost:7100", rt));
  assert.ok(!acceptOrigin("https://evil.example", rt));
  assert.ok(!acceptOrigin("https://evil.example", ""));
  assert.ok(!acceptOrigin("", ""));
});

test("burst of SDK calls: sdk.rateLimited, then restored after 1 s", () => {
  let now = 0;
  const guard = sdkGuard(() => now);
  for (let i = 0; i < MAX_CALLS_PER_SEC; i++)
    assert.equal(guard("query"), null);
  const e = guard("query");
  assert.ok(e instanceof AppError);
  assert.equal(e.code, "sdk.rateLimited");
  now = 1_001;
  assert.equal(guard("query"), null);
});

test("burst of writes: lower cap", () => {
  const guard = sdkGuard(() => 0);
  for (let i = 0; i < MAX_WRITES_PER_SEC; i++)
    assert.equal(guard("create"), null);
  assert.equal(guard("create")?.code, "sdk.rateLimited");
  assert.equal(guard("query"), null);
});
