import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../global.css";
import { Provider } from "@/components/provider";
import { i18n, isLang } from "@/lib/i18n";
import { i18nUI, messages } from "@/lib/messages";
import { siteUrl } from "@/lib/site";

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export async function generateMetadata(
  props: LayoutProps<"/[lang]">,
): Promise<Metadata> {
  const { lang } = await props.params;
  if (!isLang(lang)) notFound();
  const t = messages(lang);
  return {
    metadataBase: new URL(siteUrl()),
    title: { template: t.meta.titleTemplate, default: t.meta.title },
    description: t.meta.description,
    icons: { icon: "/docs/icon.svg" },
    openGraph: { siteName: t.meta.title, locale: t.ogLocale, type: "website" },
  };
}

export default async function Layout({ params, children }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <html lang={lang} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider i18n={i18nUI.provider(lang)}>{children}</Provider>
      </body>
    </html>
  );
}
