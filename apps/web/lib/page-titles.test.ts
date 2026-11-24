// Every route has a translated <title>: each page.tsx exports
// `generateMetadata` (pageTitle("key") or its own) with a key that exists in
// common.titles in every locale. Root layout sets the "%s · Runbase" template.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { locales } from "../i18n/config";

const APP = new URL("../app/", import.meta.url).pathname;

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "api" ? [] : pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

const titles = (locale: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../messages/${locale}/common.json`, import.meta.url),
      "utf8",
    ),
  ).titles as Record<string, string>;

test("every page exports generateMetadata with a translated title", () => {
  const files = pages(APP);
  assert.ok(files.length > 0);
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    assert.match(
      src,
      /export (const generateMetadata|(async )?function generateMetadata)/,
      `${file}: missing generateMetadata (docs/i18n.md, "Page titles")`,
    );
    for (const [, key] of src.matchAll(/pageTitle\("(\w+)"\)/g))
      for (const l of locales)
        assert.ok(titles(l)[key!], `${file}: common.titles.${key} missing in ${l}`);
  }
});

test("root layout sets a translated title template", () => {
  const src = readFileSync(join(APP, "layout.tsx"), "utf8");
  assert.match(src, /template:/);
  assert.match(src, /getTranslations\("common\.titles"\)/);
});
