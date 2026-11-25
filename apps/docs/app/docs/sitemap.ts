import type { MetadataRoute } from "next";
import { i18n } from "@/lib/i18n";
import { docsPath } from "@/lib/locale-path.mjs";
import { siteUrl } from "@/lib/site";
import { languagesOf, source } from "@/lib/source";

// Served at /docs/sitemap.xml, listed in the robots.txt of the main site.
// One entry per page and real language (no English fallback duplicates),
// each with its hreflang alternates.
export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages(i18n.defaultLanguage).flatMap((page) => {
    const langs = languagesOf(page.slugs);
    const languages = Object.fromEntries([
      ...langs.map((l) => [l, `${siteUrl()}${docsPath(l, page.slugs)}`]),
      ["x-default", `${siteUrl()}${docsPath(i18n.defaultLanguage, page.slugs)}`],
    ]);
    return langs.map((lang) => ({
      url: `${siteUrl()}${docsPath(lang, page.slugs)}`,
      alternates: { languages },
    }));
  });
}

export const dynamic = "force-dynamic";
