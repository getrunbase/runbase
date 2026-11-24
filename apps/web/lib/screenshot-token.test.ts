import { test } from "node:test";
import assert from "node:assert/strict";
import { shotToken, verifyShotToken } from "./screenshot-token";

test("capture token: signed, tampering and expiry refused", () => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret";
  const t = shotToken({ ws: "w", user: "u", page: "p" });
  assert.equal(verifyShotToken(t)?.page, "p");
  const [body, mac] = t.split(".");
  const forged = Buffer.from(
    JSON.stringify({
      ws: "w",
      user: "u",
      page: "autre",
      exp: Date.now() + 1e5,
    }),
  ).toString("base64url");
  assert.equal(verifyShotToken(`${forged}.${mac}`), null);
  assert.equal(verifyShotToken(`${body}.x`), null);
  assert.ok(verifyShotToken(t, Date.now() + 110_000));
  assert.equal(verifyShotToken(t, Date.now() + 121_000), null);
});
