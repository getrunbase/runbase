// SEO helpers of the docs pages: hreflang alternates, canonical URL,
// Open Graph image and JSON-LD (TechArticle + BreadcrumbList).
import type { Metadata } from "next";
import { i18n, type Lang } from "./i18n";
import { docsPath } from "./locale-path.mjs";
import { messages } from "./messages";
import { siteUrl } from "./site";
import { canonicalPath, languagesOf, source, type DocsPage } from "./source";

// hreflang of every existing language + x-default (English). The canonical
// URL of an untranslated page (English fallback) is the English one.
export function alternatesOf(
  pathOf: (lang: Lang) => string,
  langs: Lang[],
  lang: Lang,
): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const l of langs) languages[l] = pathOf(l);
  languages["x-default"] = pathOf(i18n.defaultLanguage);
  return {
    canonical: pathOf(langs.includes(lang) ? lang : i18n.defaultLanguage),
    languages,
  };
}

export const docsAlternates = (slugs: string[], lang: Lang) =>
  alternatesOf((l) => docsPath(l, slugs), languagesOf(slugs), lang);

// OG image generated per page and language (app/docs/og).
export const ogImagePath = (lang: Lang, slugs: string[]) =>
  `/docs/og/${lang}/${[...slugs, "image.png"].join("/")}`;

export function pageMetadata(page: DocsPage, lang: Lang): Metadata {
  const t = messages(lang);
  const image = ogImagePath(lang, page.slugs);
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: docsAlternates(page.slugs, lang),
    openGraph: {
      type: "article",
      title: page.data.title,
      description: page.data.description,
      url: canonicalPath(page.slugs, lang),
      siteName: t.meta.title,
      locale: t.ogLocale,
      images: [{ url: image, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: page.data.title,
      description: page.data.description,
      images: [image],
    },
  };
}

// Breadcrumb: docs root, then every parent folder that has a page.
function breadcrumb(page: DocsPage, lang: Lang) {
  const items = [{ name: messages(lang).breadcrumbRoot, url: docsPath(lang) }];
  for (let i = 1; i <= page.slugs.length; i++) {
    const slugs = page.slugs.slice(0, i);
    const p = source.getPage(slugs, lang);
    if (p) items.push({ name: p.data.title, url: docsPath(lang, slugs) });
  }
  return items;
}

export function jsonLd(page: DocsPage, lang: Lang) {
  const base = siteUrl();
  const url = `${base}${canonicalPath(page.slugs, lang)}`;
  const translated = languagesOf(page.slugs).includes(lang);
  return [
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: page.data.title,
      description: page.data.description,
      url,
      inLanguage: translated ? lang : i18n.defaultLanguage,
      image: `${base}${ogImagePath(lang, page.slugs)}`,
      isPartOf: { "@type": "WebSite", name: messages(lang).meta.title, url: `${base}${docsPath(lang)}` },
      publisher: { "@type": "Organization", name: messages(lang).brand, url: base },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumb(page, lang).map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: item.name,
        item: `${base}${item.url}`,
      })),
    },
  ];
}
