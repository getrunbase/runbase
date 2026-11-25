// Dead links: run before `next build`, fails on any broken internal
// link in content/docs (every language).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deadLinks, linksOf, pageUrl } from "./links.mjs";

const root = join(import.meta.dirname, "../content/docs");

test("no dead internal link in the docs", () => {
  assert.deepEqual(deadLinks(root), []);
});

test("detects a missing page and anchor, ignores code", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-links-"));
  mkdirSync(join(dir, "en", "a"), { recursive: true });
  writeFileSync(join(dir, "en", "index.mdx"), "# Home\n\n[ok](/docs/a#intro)");
  writeFileSync(
    join(dir, "en", "a", "index.mdx"),
    "## Intro\n\n[x](/docs/missing) [y](/docs#nope)\n\n```md\n[z](/docs/code)\n```",
  );
  assert.deepEqual(deadLinks(dir).sort(), [
    "en/a/index.mdx: /docs#nope",
    "en/a/index.mdx: /docs/missing",
  ]);
  assert.equal(pageUrl(join(dir, "en"), join(dir, "en", "a", "b.mdx")), "/docs/a/b");
  assert.deepEqual(linksOf("`[a](/docs/x)` [b](/docs/y)"), ["/docs/y"]);
});

test("French page: own anchors, English fallback for untranslated targets", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-links-"));
  mkdirSync(join(dir, "en"), { recursive: true });
  mkdirSync(join(dir, "fr"), { recursive: true });
  writeFileSync(join(dir, "en", "index.mdx"), "## Start here\n");
  writeFileSync(join(dir, "en", "b.mdx"), "## Setup\n");
  writeFileSync(join(dir, "fr", "index.mdx"), "## Démarrer ici\n");
  writeFileSync(
    join(dir, "fr", "c.mdx"),
    "[a](/docs#démarrer-ici) [b](/docs/b#setup) [c](/docs#start-here) [d](/docs/fr/b)",
  );
  assert.deepEqual(deadLinks(dir), ["fr/c.mdx: /docs#start-here"]);
});
