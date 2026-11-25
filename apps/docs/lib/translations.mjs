// Translation parity of the docs: every English page has a French page at
// the same path (content/docs/en/x.mdx -> content/docs/fr/x.mdx), and every
// folder title (meta.json with a "title") too. Pages generated from the
// code (scripts/gen-docs.mts banner) are generated in French too by
// `pnpm gen:docs` (translations in translations/fr/), so they count as well.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.(mdx|json)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

const rel = (root, f) => relative(root, f).replace(/\\/g, "/");

// English files that need a French version (relative paths).
export function translatable(root) {
  const en = join(root, "en");
  const all = files(en);
  return all
    // meta.json: only when it has a title shown in the sidebar.
    .filter((f) => f.endsWith(".mdx") || JSON.parse(readFileSync(f, "utf8")).title)
    .map((f) => rel(en, f))
    .sort();
}

// { missing: English files without French version, orphans: French files
// without English source }.
export function parity(root) {
  const fr = new Set(files(join(root, "fr")).map((f) => rel(join(root, "fr"), f)));
  const en = new Set(files(join(root, "en")).map((f) => rel(join(root, "en"), f)));
  return {
    missing: translatable(root).filter((f) => !fr.has(f)),
    orphans: [...fr].filter((f) => !en.has(f)).sort(),
  };
}
