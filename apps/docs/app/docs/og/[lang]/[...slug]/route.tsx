import { generateOGImage } from "fumadocs-ui/og";
import { notFound } from "next/navigation";
import { isLang } from "@/lib/i18n";
import { messages } from "@/lib/messages";
import { source } from "@/lib/source";

// Open Graph image of a page: /docs/og/<lang>/<...slugs>/image.png.
export async function GET(
  _req: Request,
  { params }: RouteContext<"/docs/og/[lang]/[...slug]">,
) {
  const { lang, slug } = await params;
  if (!isLang(lang)) notFound();
  const page = source.getPage(slug.slice(0, -1), lang);
  if (!page) notFound();
  return generateOGImage({
    title: page.data.title,
    description: page.data.description,
    site: messages(lang).meta.title,
  });
}

export function generateStaticParams() {
  return source.generateParams().map(({ lang, slug = [] }) => ({
    lang,
    slug: [...slug, "image.png"],
  }));
}
