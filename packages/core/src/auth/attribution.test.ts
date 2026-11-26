import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributionFromCookieHeader,
  attributionFromQuery,
  decodeAttribution,
  encodeAttribution,
} from "./attribution";

test("keeps allowlisted params only, trimmed and truncated", () => {
  const a = attributionFromQuery(
    new URLSearchParams({ utm_source: " x ", twclid: "c".repeat(300), email: "a@b.c" }),
  );
  assert.deepEqual(a, { utm_source: "x", twclid: "c".repeat(200) });
});

test("returns null without attribution params", () => {
  assert.equal(attributionFromQuery(new URLSearchParams("next=/x")), null);
});

test("round-trips through the cookie header", () => {
  const raw = encodeAttribution({ utm_campaign: "launch", gclid: "g1" });
  assert.deepEqual(attributionFromCookieHeader(`a=1; runbase_attribution=${raw}; b=2`), {
    utm_campaign: "launch",
    gclid: "g1",
  });
});

test("ignores malformed or foreign values", () => {
  assert.deepEqual(decodeAttribution("%7Bnot-json"), {});
  assert.deepEqual(decodeAttribution(encodeURIComponent("[1]")), {});
  assert.deepEqual(decodeAttribution(encodeURIComponent('{"utm_source":3,"x":"y"}')), {});
  assert.deepEqual(attributionFromCookieHeader(null), {});
});
