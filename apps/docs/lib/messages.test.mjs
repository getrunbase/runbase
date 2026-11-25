// Docs site texts: same keys in every language, no empty value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES } from "./locale-path.mjs";

const load = (lang, ns) =>
  JSON.parse(readFileSync(join(import.meta.dirname, `../messages/${lang}/${ns}.json`), "utf8"));

const keys = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`],
  );

for (const ns of ["site", "generated"])
test(`${ns}.json: same keys in every language, no empty value`, () => {
  const en = keys(load("en", ns)).sort();
  for (const lang of LANGUAGES) {
    const msgs = load(lang, ns);
    assert.deepEqual(keys(msgs).sort(), en, lang);
    for (const k of en)
      assert.ok(k.split(".").reduce((o, s) => o[s], msgs), `${lang}: ${k}`);
  }
});

test("fumadocs.json (French UI of Fumadocs): no empty value", () => {
  for (const [k, v] of Object.entries(load("fr", "fumadocs")))
    assert.ok(typeof v === "string" && v.trim(), k);
});
