// README link checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deadExternalLinks,
  deadLocalLinks,
  linksOf,
} from "./check-readme-links.mjs";

const root = join(import.meta.dirname, "..");

test("the repository README has no dead relative link", () => {
  assert.deepEqual(deadLocalLinks(join(root, "README.md")), []);
});

test("relative links: missing file detected, code and comments ignored", () => {
  const dir = mkdtempSync(join(tmpdir(), "readme-links-"));
  writeFileSync(join(dir, "ok.md"), "");
  const file = join(dir, "README.md");
  writeFileSync(
    file,
    [
      "[ok](ok.md#x) [gone](missing.md) [anchor](#top) [web](https://x.io)",
      "![img](img.png)",
      "<!-- [hidden](nope.md) -->",
      "```md\n[code](nope2.md)\n```",
    ].join("\n"),
  );
  assert.deepEqual(deadLocalLinks(file), ["missing.md", "img.png"]);
  assert.deepEqual(linksOf('[t](a.md "title")'), ["a.md"]);
});

test("external links: status >= 400 or network error = dead, one retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "readme-ext-"));
  const file = join(dir, "README.md");
  writeFileSync(
    file,
    "[a](https://ok.io) [b](https://gone.io) [c](https://flaky.io) [d](https://down.io)",
  );
  const calls = new Map();
  const fetcher = async (url) => {
    const n = (calls.get(url) ?? 0) + 1;
    calls.set(url, n);
    if (url.includes("down")) throw new Error("ECONNREFUSED");
    if (url.includes("flaky")) return { status: n === 1 ? 503 : 200 };
    return { status: url.includes("gone") ? 404 : 200 };
  };
  assert.deepEqual(await deadExternalLinks(file, fetcher), [
    "https://gone.io",
    "https://down.io",
  ]);
  assert.equal(calls.get("https://flaky.io"), 2);
});
