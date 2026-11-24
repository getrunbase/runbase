#!/usr/bin/env node
// Placeholders left in tracked files: fails when a file contains a marker
// that must be replaced before release (e.g. `<repository-url>`).
// Usage: node scripts/check-placeholders.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { argv, exit, stderr } from "node:process";
import { fileURLToPath } from "node:url";

export const PLACEHOLDERS = ["<repository-url>"];

// Lines containing a placeholder, as `file:line: text`.
export function findPlaceholders(files, read = (f) => readFileSync(f, "utf8")) {
  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    text.split("\n").forEach((line, i) => {
      if (PLACEHOLDERS.some((p) => line.includes(p)))
        hits.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  const self = "scripts/check-placeholders.mjs";
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => f && f !== self && !f.endsWith(".test.mjs"));
  const hits = findPlaceholders(files);
  if (hits.length) {
    stderr.write(`Placeholders to replace:\n${hits.join("\n")}\n`);
    exit(1);
  }
}
