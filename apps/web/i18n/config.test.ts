import assert from "node:assert/strict";
import { test } from "node:test";
import { negotiate } from "./config";

test("negotiate: Accept-Language -> supported locale, otherwise en", () => {
  assert.equal(negotiate("fr-FR,fr;q=0.9,en;q=0.8"), "fr");
  assert.equal(negotiate("de-DE,en-US;q=0.7"), "en");
  assert.equal(negotiate("de"), "en");
  assert.equal(negotiate(null), "en");
});
