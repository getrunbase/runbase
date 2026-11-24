import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { siteUrl } from "@/lib/site";

// Served at /docs/sitemap.xml, listed in the robots.txt of the main site.
export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({ url: `${siteUrl()}${page.url}` }));
}

export const dynamic = "force-dynamic";
