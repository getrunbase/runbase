import assert from "node:assert/strict";
import { test } from "node:test";
import { googleErrorKey } from "./auth-client";

test("Google sign-in errors: translated key only after a Google redirect", () => {
  const q = (s: string) => new URLSearchParams(s);
  assert.equal(googleErrorKey(q("")), undefined);
  // Expired magic link: not a Google error.
  assert.equal(googleErrorKey(q("error=lien")), undefined);
  assert.equal(googleErrorKey(q("google=1")), undefined);
  assert.equal(googleErrorKey(q("google=1&error=signup_disabled")), "googleClosed");
  assert.equal(
    googleErrorKey(q("google=1&error=account_not_linked")),
    "googleNotLinked",
  );
  assert.equal(googleErrorKey(q("google=1&error=access_denied")), "googleFailed");
});
