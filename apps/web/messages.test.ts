import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { locales, namespaces } from "./i18n/config";

// Translation parity: every locale has exactly the keys of `en`,
// no empty value. Fails if a dev adds a key in only one locale.
const keys = (o: unknown, p = ""): string[] =>
  typeof o === "object" && o !== null
    ? Object.entries(o).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k))
    : [p];
const load = (l: string, ns: string) =>
  JSON.parse(readFileSync(new URL(`./messages/${l}/${ns}.json`, import.meta.url), "utf8"));

for (const ns of namespaces) {
  test(`messages ${ns}: same keys in every locale`, () => {
    const ref = keys(load("en", ns)).sort();
    for (const l of locales) {
      const m = load(l, ns);
      assert.deepEqual(keys(m).sort(), ref, `${l}/${ns}.json`);
      for (const k of keys(m)) {
        const v = k.split(".").reduce((o, s) => o[s], m);
        assert.ok(typeof v === "string" && v.trim(), `${l}/${ns}.json : ${k} vide`);
      }
    }
  });
}
