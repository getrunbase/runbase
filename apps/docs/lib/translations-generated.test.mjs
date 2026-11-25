// French translations of the texts coming from the code (generated pages,
// scripts/gen-docs.mts). The run of `pnpm gen:docs` fails on any missing or
// stale id; this test checks the shape of the translation files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "../translations/fr");

test("translations/fr/generated.json: { en, fr } entries, none empty", () => {
  const entries = JSON.parse(readFileSync(join(dir, "generated.json"), "utf8"));
  const ids = Object.keys(entries);
  assert.ok(ids.length > 0);
  assert.deepEqual(ids, [...ids].sort(), "ids sorted");
  for (const [id, e] of Object.entries(entries)) {
    assert.equal(typeof e.en, "string", id);
    assert.ok(typeof e.fr === "string" && e.fr.trim(), `${id}: empty French text`);
  }
});

test("translations/fr/self-hosting.md: records the hash of its English source", () => {
  const md = readFileSync(join(dir, "self-hosting.md"), "utf8");
  assert.match(md, /^<!-- source-sha256: [0-9a-f]{64} -->\n# /);
});
