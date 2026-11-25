import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import type { Lang } from "@/lib/i18n";
import { source } from "@/lib/source";

export default async function Layout({ params, children }: LayoutProps<"/[lang]/docs">) {
  const lang = (await params).lang as Lang;
  return (
    <DocsLayout tree={source.getPageTree(lang)} {...baseOptions(lang)}>
      {children}
    </DocsLayout>
  );
}
