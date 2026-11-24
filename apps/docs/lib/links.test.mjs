// Dead links: run before `next build`, fails on any broken internal
// link in content/docs.
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
  mkdirSync(join(dir, "a"));
  writeFileSync(join(dir, "index.mdx"), "# Home\n\n[ok](/docs/a#intro)");
  writeFileSync(
    join(dir, "a", "index.mdx"),
    "## Intro\n\n[x](/docs/missing) [y](/docs#nope)\n\n```md\n[z](/docs/code)\n```",
  );
  assert.deepEqual(deadLinks(dir).sort(), [
    "a/index.mdx: /docs#nope",
    "a/index.mdx: /docs/missing",
  ]);
  assert.equal(pageUrl(dir, join(dir, "a", "b.mdx")), "/docs/a/b");
  assert.deepEqual(linksOf("`[a](/docs/x)` [b](/docs/y)"), ["/docs/y"]);
});
