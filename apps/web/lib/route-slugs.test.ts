// Every static route segment is in English, lowercase, kebab-case.
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Segments imposed by external standards.
const EXEMPT = new Set([".well-known", "openapi.json"]);
const root = join(import.meta.dirname, "..", "app");

function segments(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    // Dynamic [x], groups (x), private _x and parallel @x: outside the rule.
    if (!/^[[(_@]/.test(name) && !EXEMPT.has(name)) out.push(full.slice(root.length));
    segments(full, out);
  }
  return out;
}

test("static route segments in kebab-case", () => {
  const bad = segments(root).filter((p) => !SLUG.test(p.split("/").pop()!));
  assert.deepEqual(bad, []);
});
