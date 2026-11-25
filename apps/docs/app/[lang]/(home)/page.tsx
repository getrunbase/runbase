import type { Metadata } from "next";
import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { docsPath, homePath } from "@/lib/locale-path.mjs";
import { messages } from "@/lib/messages";
import { alternatesOf } from "@/lib/seo";

const sections = [
  { key: "quickstart", slugs: ["quickstart"] },
  { key: "selfHosting", slugs: ["self-hosting"] },
  { key: "concepts", slugs: ["concepts"] },
  { key: "reference", slugs: ["reference"] },
] as const;

export async function generateMetadata(props: PageProps<"/[lang]">): Promise<Metadata> {
  const lang = (await props.params).lang as Lang;
  return {
    alternates: alternatesOf(homePath, ["en", "fr"], lang),
  };
}

export default async function HomePage(props: PageProps<"/[lang]">) {
  const lang = (await props.params).lang as Lang;
  const t = messages(lang).home;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-4 py-16">
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold">{t.title}</h1>
        <p className="text-lg text-fd-muted-foreground">{t.lead}</p>
        <div>
          <Link
            href={docsPath(lang, ["quickstart"])}
            className="inline-flex rounded-md bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground"
          >
            {t.cta}
          </Link>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <Link
            key={s.key}
            href={docsPath(lang, [...s.slugs])}
            className="rounded-lg border bg-fd-card p-4 hover:bg-fd-accent"
          >
            <h2 className="font-semibold">{t[s.key].title}</h2>
            <p className="text-sm text-fd-muted-foreground">{t[s.key].text}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
