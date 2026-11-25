// Internal docs links: every `/docs/...` link of an MDX page must target
// an existing page (and an existing anchor for `#...`).
// Content: <root>/<lang>/**.mdx. A French page links with English URLs
// (`/docs/x`): they are rendered as `/docs/fr/x`, which shows the French
// page or, when missing, the English fallback. So a link is checked
// against the page of the same language, else the English page.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./locale-path.mjs";

// Heading anchor (github-slugger rule): accented letters are kept.
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");

export function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : e.name.endsWith(".mdx")
        ? [join(dir, e.name)]
        : [],
  );
}

// URL of a page, without language: <lang>/a/index.mdx -> /docs/a.
export function pageUrl(langRoot, file) {
  const rel = relative(langRoot, file)
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

function pagesOf(langRoot) {
  const pages = new Map();
  for (const f of walk(langRoot)) {
    const src = readFileSync(f, "utf8");
    const anchors = new Set(
      [...src.replace(/```[\s\S]*?```/g, "").matchAll(/^#{1,6} (.+)$/gm)].map(
        (m) => slugify(m[1]),
      ),
    );
    pages.set(pageUrl(langRoot, f), { src, anchors, file: f });
  }
  return pages;
}

export function deadLinks(root) {
  const byLang = Object.fromEntries(
    LANGUAGES.map((l) => [l, pagesOf(join(root, l))]),
  );
  const dead = [];
  for (const lang of LANGUAGES)
    for (const { src, file } of byLang[lang].values())
      for (const link of linksOf(src)) {
        const [raw, hash] = link.split("#");
        // Links written with a language prefix (/docs/fr/x) are allowed too.
        const m = raw.match(new RegExp(`^/docs/(${LANGUAGES.join("|")})(?=/|$)(.*)$`));
        const targetLang = m ? m[1] : lang;
        const path = (m ? `/docs${m[2]}` : raw).replace(/\/$/, "") || "/docs";
        const target =
          byLang[targetLang].get(path) ?? byLang[DEFAULT_LANGUAGE].get(path);
        if (!target || (hash && !target.anchors.has(hash)))
          dead.push(`${relative(root, file)}: ${link}`);
      }
  return dead;
}
