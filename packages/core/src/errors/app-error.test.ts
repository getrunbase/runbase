import assert from "node:assert/strict";
import { test } from "node:test";
import { appError, authStatus, forbidden, unauthorized } from "./app-error";

test("unauthorized / forbidden: kind and HTTP status", () => {
  const u = unauthorized("apiKeys.invalid", "Invalid API key");
  const f = forbidden("apiKeys.scopeRequired", "Scope {needed} required", {
    needed: "write",
  });
  assert.equal(u.kind, "unauthorized");
  assert.equal(authStatus(u), 401);
  assert.equal(f.kind, "forbidden");
  assert.equal(f.message, "Scope write required");
  assert.equal(authStatus(f), 403);
});

test("authStatus: undefined outside authentication errors", () => {
  assert.equal(authStatus(appError("x.y", "z")), undefined);
  assert.equal(authStatus(new Error("boom")), undefined);
  assert.equal(authStatus("text"), undefined);
});
