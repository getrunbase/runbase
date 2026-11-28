// Runtime iframe bridge: origin filter and SDK call cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "@getrunbase/core/app-error";
import {
  acceptOrigin,
  externalUrl,
  openExternal,
  openUrlGate,
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

test("externalUrl: only absolute https without credentials", () => {
  assert.equal(
    externalUrl("https://example.com/a?b=1")?.href,
    "https://example.com/a?b=1",
  );
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " https://example.com",
    "data:text/html,hi",
    "blob:https://example.com/x",
    "file:///etc/passwd",
    "http://example.com",
    "//example.com",
    "/p/home",
    "example.com",
    "https://user:pw@example.com",
    "https://user@example.com",
    "https://exa\nmple.com",
    "https://example.com/\u0000",
    "https:\\\\example.com",
    "https://",
    "https://" + "a".repeat(3000) + ".com",
    42,
    null,
  ])
    assert.equal(externalUrl(bad), null, String(bad));
});

test("openUrlGate: source, activation and rate are enforced", () => {
  let t = 0;
  const gate = openUrlGate(() => t);
  const frame = {};
  const msg = { type: "openUrl", url: "https://example.com" };
  const on = { isActive: true };
  // Wrong source ignored.
  assert.equal(gate({ source: {}, data: msg }, frame, on), null);
  assert.equal(gate({ source: null, data: msg }, null, on), null);
  // No activation: no open.
  assert.equal(
    gate({ source: frame, data: msg }, frame, { isActive: false }),
    null,
  );
  assert.equal(gate({ source: frame, data: msg }, frame, undefined), null);
  // Rejected scheme.
  assert.equal(
    gate(
      { source: frame, data: { type: "openUrl", url: "javascript:1" } },
      frame,
      on,
    ),
    null,
  );
  assert.equal(
    gate({ source: frame, data: msg }, frame, on)?.host,
    "example.com",
  );
  // At most 1 per second.
  t = 500;
  assert.equal(gate({ source: frame, data: msg }, frame, on), null);
  t = 1_600;
  assert.ok(gate({ source: frame, data: msg }, frame, on));
});

test("openExternal: new tab with noopener and noreferrer", () => {
  const calls: string[][] = [];
  openExternal(new URL("https://example.com"), (...a) => calls.push(a));
  assert.deepEqual(calls, [
    ["https://example.com/", "_blank", "noopener,noreferrer"],
  ]);
});
