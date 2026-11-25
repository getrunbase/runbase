import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentProps } from "react";
import { getMDXComponents } from "@/components/mdx";
import type { Lang } from "@/lib/i18n";
import { localizeHref } from "@/lib/locale-path.mjs";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { source } from "@/lib/source";

export default async function Page(props: PageProps<"/[lang]/docs/[[...slug]]">) {
  const { lang, slug } = await props.params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();
  const MDX = page.data.body;
  const RelativeLink = createRelativeLink(source, page);
  // `/docs/x` links of a translated page go to the same language.
  const Link = (p: ComponentProps<"a">) => (
    <RelativeLink {...p} href={localizeHref(p.href, lang)} />
  );
  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd(page, lang as Lang)).replace(/</g, "\\u003c"),
        }}
      />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents({ a: Link })} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<"/[lang]/docs/[[...slug]]">,
): Promise<Metadata> {
  const { lang, slug } = await props.params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();
  return pageMetadata(page, lang as Lang);
}
