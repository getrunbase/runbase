// Internal docs links: every `/docs/...` link of an MDX page
// must target an existing page (and an existing anchor for `#...`).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : e.name.endsWith(".mdx")
        ? [join(dir, e.name)]
        : [],
  );
}

// URL of a page: content/docs/a/index.mdx -> /docs/a.
export function pageUrl(root, file) {
  const rel = relative(root, file)
    .replace(/\\/g, "/")
    .replace(/\.mdx$/, "")
    .replace(/(^|\/)index$/, "");
  return rel ? `/docs/${rel}` : "/docs";
}

// Markdown links outside code blocks.
export function linksOf(mdx) {
  const text = mdx.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...text.matchAll(/\]\((\/docs[^)\s]*)\)/g)].map((m) => m[1]);
}

export function deadLinks(root) {
  const pages = new Map();
  for (const f of walk(root)) {
    const src = readFileSync(f, "utf8");
    const anchors = new Set(
      [...src.replace(/```[\s\S]*?```/g, "").matchAll(/^#{1,6} (.+)$/gm)].map(
        (m) => slugify(m[1]),
      ),
    );
    pages.set(pageUrl(root, f), { src, anchors, file: f });
  }
  const dead = [];
  for (const { src, file } of pages.values())
    for (const link of linksOf(src)) {
      const [path, hash] = link.split("#");
      const target = pages.get(path.replace(/\/$/, ""));
      if (!target || (hash && !target.anchors.has(hash)))
        dead.push(`${relative(root, file)}: ${link}`);
    }
  return dead;
}
