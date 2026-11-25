// Public docs URLs per language and proxy routing.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docsPath,
  homePath,
  langOf,
  localizeHref,
  route,
  switchLanguage,
} from "./locale-path.mjs";

test("public URLs: English without prefix, French under /docs/fr", () => {
  assert.equal(docsPath("en"), "/docs");
  assert.equal(docsPath("en", ["concepts", "data"]), "/docs/concepts/data");
  assert.equal(docsPath("fr", ["quickstart"]), "/docs/fr/quickstart");
  assert.equal(homePath("en"), "/");
  assert.equal(homePath("fr"), "/fr");
  assert.equal(langOf("/docs/fr/x"), "fr");
  assert.equal(langOf("/docs/x"), "en");
  assert.equal(langOf("/fr"), "fr");
  assert.equal(langOf("/docs/frx"), "en");
});

test("proxy: rewrites public paths, redirects the hidden default", () => {
  assert.deepEqual(route("/docs"), { rewrite: "/en/docs" });
  assert.deepEqual(route("/docs/quickstart"), { rewrite: "/en/docs/quickstart" });
  assert.deepEqual(route("/docs/fr"), { rewrite: "/fr/docs" });
  assert.deepEqual(route("/docs/fr/concepts/data"), { rewrite: "/fr/docs/concepts/data" });
  assert.deepEqual(route("/docs/english"), { rewrite: "/en/docs/english" });
  assert.deepEqual(route("/docs/en/quickstart"), { redirect: "/docs/quickstart" });
  assert.deepEqual(route("/docs/en"), { redirect: "/docs" });
  assert.deepEqual(route("/"), { rewrite: "/en" });
  assert.equal(route("/fr"), null);
  assert.deepEqual(route("/en"), { redirect: "/" });
  assert.deepEqual(route("/en/docs/x"), { redirect: "/docs/x" });
  assert.deepEqual(route("/fr/docs/x"), { redirect: "/docs/fr/x" });
});

test("language switcher keeps the page", () => {
  assert.equal(switchLanguage("/docs/quickstart", "fr"), "/docs/fr/quickstart");
  assert.equal(switchLanguage("/docs/fr/quickstart", "en"), "/docs/quickstart");
  assert.equal(switchLanguage("/docs", "fr"), "/docs/fr");
  assert.equal(switchLanguage("/docs/fr", "en"), "/docs");
  assert.equal(switchLanguage("/", "fr"), "/fr");
  assert.equal(switchLanguage("/fr", "en"), "/");
  assert.equal(switchLanguage("/fr", "fr"), "/fr");
});

test("MDX docs links follow the page language", () => {
  assert.equal(localizeHref("/docs/concepts#data", "fr"), "/docs/fr/concepts#data");
  assert.equal(localizeHref("/docs", "fr"), "/docs/fr");
  assert.equal(localizeHref("/docs/fr/x", "fr"), "/docs/fr/x");
  assert.equal(localizeHref("/docs/api/search", "fr"), "/docs/api/search");
  assert.equal(localizeHref("https://example.com", "fr"), "https://example.com");
  assert.equal(localizeHref("/docs/x", "en"), "/docs/x");
});
