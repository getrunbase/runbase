import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FR_ERRORS } from "./error-text";

// Displayable error codes: every literal code passed to appError,
// errorItem, notFound, unauthorized, forbidden or requireConfirm (core + web) has its translation in
// messages/fr/errors/*.json, and every translation is still used.
// The MCP (app/api/mcp) is excluded: its errors are only shown to agents.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const SCAN = ["packages/core/src", "apps/web"];
const SKIP = /node_modules|\.next|[\\/]api[\\/]mcp[\\/]|\.test\.tsx?$/;
const CALL =
  /\b(?:appError|errorItem|notFound|unauthorized|forbidden)\(\s*"([\w.]+)"|\brequireConfirm\(\s*[^,()]+,\s*"([\w.]+)"/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (SKIP.test(p)) return [];
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

const used = new Set<string>();
for (const f of SCAN.flatMap((d) => files(join(root, d))))
  // Comments ignored (API examples).
  for (const m of readFileSync(f, "utf8")
    .replace(/^\s*(\/\/|\*).*$/gm, "")
    .matchAll(CALL))
    used.add((m[1] ?? m[2])!);

test("every error code has its French translation", () => {
  const missing = [...used].filter((c) => !(c in FR_ERRORS)).sort();
  assert.deepEqual(
    missing,
    [],
    "à ajouter dans messages/fr/errors/<domaine>.json",
  );
});

test("aucune traduction d'erreur orpheline", () => {
  const orphans = Object.keys(FR_ERRORS)
    .filter((c) => !used.has(c))
    .sort();
  assert.deepEqual(
    orphans,
    [],
    "codes plus utilisés : retirer de messages/fr/errors",
  );
});

// MCP English only: no French string outside comments
// in app/api/mcp (tests excluded). French accents or function words.
const FRENCH =
  /[àâçéèêëîïôûùüœ]|\b(?:sans|manquant|introuvable|requis|aucune?|les|des|du|une|est|pas|avec|pour|dans)\b/i;
const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

export function frenchStrings(source: string): string[] {
  return [
    ...source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/([;,)}{\]])\s*\/\/.*$/gm, "$1")
      .matchAll(STRING),
  ]
    .map((m) => m[0])
    .filter((s) => FRENCH.test(s));
}

test("French detector: FR strings found, comments ignored", () => {
  assert.deepEqual(
    frenchStrings(
      '// Le défaut du client\nconst a = "Token sans client id"; // é\nconst b = "No accessible workspace";',
    ),
    ['"Token sans client id"'],
  );
});

test("no French text in app/api/mcp", () => {
  const dir = join(root, "apps/web/app/api/mcp");
  const found = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$|test-client/.test(n))
    .flatMap((n) =>
      frenchStrings(readFileSync(join(dir, n), "utf8")).map(
        (s) => `${n}: ${s}`,
      ),
    );
  assert.deepEqual(found, [], "MCP : messages en anglais (appError)");
});

test("codes in domain.camelName format, non-empty values", () => {
  for (const [k, v] of Object.entries(FR_ERRORS)) {
    assert.match(k, /^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z0-9]*)+$/, k);
    assert.ok(v.trim(), `${k} vide`);
  }
});
