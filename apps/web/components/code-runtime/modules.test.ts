// All installed shadcn components and vendor libs are exposed to the
// code components; tiptap and maplibre stay lazy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileComponent } from "@runbase/core/components";
import { chunkScript, runtimeScript } from "@/lib/code-runtime";
import { lazyChunks, lazyModules, modules } from "./modules";

const LIBS = [
  "@dnd-kit/core",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",
  "@tanstack/react-table",
  "@tanstack/react-virtual",
  "react-hook-form",
  "zod",
  "motion",
  "motion/react",
  "@xyflow/react",
  "react-markdown",
  "react-day-picker",
];
const LAZY = ["@tiptap/react", "@tiptap/starter-kit", "maplibre-gl"];

test("every file in components/ui is exposed as @ui/<name>", () => {
  const dir = join(import.meta.dirname, "../ui");
  const src = readFileSync(join(import.meta.dirname, "modules.ts"), "utf8");
  const missing = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.slice(0, -4))
    .filter((n) => !src.includes(`"@ui/${n}":`));
  assert.deepEqual(missing, []);
});

test("every vendor lib is exposed, tiptap and maplibre only lazily", () => {
  for (const lib of LIBS) {
    const m = modules[lib] as Record<string, unknown> | undefined;
    assert.ok(m && Object.keys(m).length, lib);
  }
  assert.deepEqual(Object.keys(lazyModules).sort(), [...LAZY].sort());
  for (const lib of LAZY) assert.equal(modules[lib], undefined, lib);
  // No static import of lazy libs in the initial vendor.
  const src = readFileSync(join(import.meta.dirname, "modules.ts"), "utf8");
  assert.doesNotMatch(src, /^import .* from "(@tiptap|maplibre)/m);
});

test("a package importing every lib compiles and runs", async () => {
  const all = [...LIBS, ...LAZY];
  const source = [
    ...all.map((l, i) => `import * as m${i} from ${JSON.stringify(l)};`),
    `export default () => [${all.map((_, i) => `m${i}`).join(",")}];`,
  ].join("\n");
  const r = await compileComponent(source);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(lazyChunks(r.bundle!).sort(), ["maplibre", "tiptap"]);
  const g = globalThis as Record<string, unknown>;
  g.__vendor = { ...modules };
  // Chunks as served to the iframe (IIFE, React read from __vendor).
  for (const c of lazyChunks(r.bundle!) as ("tiptap" | "maplibre")[])
    new Function(await chunkScript(c))();
  const C = (
    new Function(`${r.bundle};return __C`)() as { default: () => unknown[] }
  ).default;
  const got = C();
  assert.equal(got.length, all.length);
  for (const [i, m] of got.entries()) assert.ok(m, all[i]);
});

test("no lazy chunk if the bundle imports neither tiptap nor maplibre", async () => {
  const r = await compileComponent(
    `import { z } from "zod"; export default () => z;`,
  );
  assert.deepEqual(lazyChunks(r.bundle!), []);
});

test("build: tiptap and maplibre outside the initial vendor, in separate chunks", async () => {
  const main = await runtimeScript();
  // Internal markers (exports/classes), not the module names.
  assert.doesNotMatch(main, /ProseMirror|useEditor|setRTLTextPlugin/);
  const tiptap = await chunkScript("tiptap");
  const maplibre = await chunkScript("maplibre");
  assert.match(tiptap, /ProseMirror/);
  assert.match(tiptap, /useEditor/);
  assert.match(maplibre, /setRTLTextPlugin/);
  // Shared React: no second copy in the chunks.
  for (const c of [tiptap, maplibre])
    assert.doesNotMatch(c, /__CLIENT_INTERNALS_DO_NOT_USE/);
  console.log(
    `runtime ${(main.length / 1024) | 0} KiB, tiptap ${(tiptap.length / 1024) | 0} KiB, maplibre ${(maplibre.length / 1024) | 0} KiB`,
  );
});

test("unlisted import refused", async () => {
  for (const spec of [
    "@dnd-kit/accessibility",
    "zod/v4",
    "@tiptap/core",
    "framer-motion",
  ]) {
    const r = await compileComponent(
      `import x from ${JSON.stringify(spec)}; export default () => x;`,
    );
    assert.match(r.errors[0]!.text, /forbidden import/, spec);
  }
});
