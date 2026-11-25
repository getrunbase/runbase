// Fumadocs source: MDX pages of content/docs/<lang> (written guides +
// generated references). A French page missing from content/docs/fr falls
// back to the English page (i18n.fallbackLanguage).
import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { i18n, type Lang } from "./i18n";
import { docsPath } from "./locale-path.mjs";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    // Languages unknown to Shiki (caddyfile…): rendered as plain text.
    mdxOptions: applyMdxPreset({
      rehypeCodeOptions: { fallbackLanguage: "plaintext" },
    }),
  },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: "/docs",
  i18n,
  // English without prefix (/docs/x), French under /docs/fr/x.
  url: (slugs, locale) => docsPath(locale ?? i18n.defaultLanguage, slugs),
  source: docs.toFumadocsSource(),
});

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;

// Languages in which a page really exists (not an English fallback).
export function languagesOf(slugs: string[]): Lang[] {
  const en = source.getPage(slugs, i18n.defaultLanguage);
  return i18n.languages.filter((lang) => {
    const page = source.getPage(slugs, lang);
    return page && (lang === i18n.defaultLanguage || page.data !== en?.data);
  });
}

// Canonical URL of a page in a language: the English URL when the page
// is not translated yet (fallback content), its own URL otherwise.
export function canonicalPath(slugs: string[], lang: Lang): string {
  return docsPath(
    languagesOf(slugs).includes(lang) ? lang : i18n.defaultLanguage,
    slugs,
  );
}
