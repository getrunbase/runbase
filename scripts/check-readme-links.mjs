#!/usr/bin/env node
// README links: every relative link must target a file or a
// folder of the repository; with --external, every http(s) URL must answer < 400.
// Usage: node scripts/check-readme-links.mjs [--external] [file.md...]
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, cwd, exit, stderr, stdout } from "node:process";

// Markdown links `[x](target)` and `![x](target)` outside code blocks and
// HTML comments; `<url>` and titles ignored.
export function linksOf(md) {
  const text = md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/`[^`\n]*`/g, "");
  return [...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
}

// Broken relative links (bare `#…` anchors ignored).
export function deadLocalLinks(file) {
  const base = dirname(file);
  return linksOf(readFileSync(file, "utf8"))
    .filter((l) => !/^[a-z]+:/i.test(l) && !l.startsWith("#"))
    .filter((l) => !existsSync(resolve(base, decodeURI(l.split("#")[0]))));
}

export async function deadExternalLinks(file, fetcher = globalThis.fetch) {
  const urls = [
    ...new Set(
      linksOf(readFileSync(file, "utf8")).filter((l) => /^https?:/.test(l)),
    ),
  ];
  const dead = [];
  for (const url of urls) {
    let ok = false;
    // Two attempts: a transient network failure does not break CI.
    for (let i = 0; i < 2 && !ok; i++)
      ok = await fetcher(url, { method: "GET", redirect: "follow" }).then(
        (r) => r.status < 400,
        () => false,
      );
    if (!ok) dead.push(url);
  }
  return dead;
}

if (import.meta.url === `file://${resolve(argv[1] ?? "")}`) {
  const args = argv.slice(2);
  const external = args.includes("--external");
  const files = args.filter((a) => !a.startsWith("--"));
  const dead = [];
  for (const f of files.length ? files : ["README.md"]) {
    const file = resolve(cwd(), f);
    for (const l of deadLocalLinks(file)) dead.push(`${f}: ${l}`);
    if (external)
      for (const l of await deadExternalLinks(file)) dead.push(`${f}: ${l}`);
  }
  if (dead.length) {
    stderr.write(`Dead links:\n${dead.map((d) => `  ${d}`).join("\n")}\n`);
    exit(1);
  }
  stdout.write("README links OK\n");
}
