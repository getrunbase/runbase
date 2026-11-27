// Customer pages are never translated by the app's i18n: nothing exposed to
// them through modules.ts (@ui/*, @getrunbase/kit) may depend on next-intl,
// which throws without a NextIntlClientProvider (absent from the runtime).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const WEB = join(import.meta.dirname, "../..");
const ROOT = join(WEB, "../..");
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;

function resolveFile(base: string): string | null {
  for (const p of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ])
    if (existsSync(p) && statSync(p).isFile()) return p;
  return null;
}

// Local files only (node_modules libs are not ours to check).
function resolveSpec(spec: string, from: string): string | null {
  if (spec.startsWith(".")) return resolveFile(resolve(dirname(from), spec));
  if (spec.startsWith("@/")) return resolveFile(join(WEB, spec.slice(2)));
  if (spec.startsWith("@ui/"))
    return resolveFile(join(WEB, "components/ui", spec.slice(4)));
  if (spec === "cn") return join(WEB, "lib/cn.ts");
  if (spec.startsWith("@getrunbase/ui/"))
    return resolveFile(
      join(ROOT, "packages/ui", spec.slice("@getrunbase/ui/".length)),
    );
  if (spec === "@getrunbase/kit")
    return join(ROOT, "packages/kit/src/index.ts");
  return null;
}

test("no module exposed to customer pages imports next-intl", () => {
  const entry = join(WEB, "components/code-runtime/modules.ts");
  const seen = new Set<string>();
  const offenders: string[] = [];
  const stack = [...readFileSync(entry, "utf8").matchAll(IMPORT)]
    .map((m) => resolveSpec(m[1]!, entry))
    .filter((p): p is string => !!p);
  assert.ok(stack.some((p) => p.endsWith("components/ui/dialog.tsx")));
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (m[1] === "next-intl" || m[1]!.startsWith("next-intl/"))
        offenders.push(file.slice(ROOT.length + 1));
      const next = resolveSpec(m[1]!, file);
      if (next) stack.push(next);
    }
  }
  assert.deepEqual(offenders, []);
});
