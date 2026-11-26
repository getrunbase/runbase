import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, LayoutTemplate } from "lucide-react";
import type { TemplateSummary } from "@getrunbase/core/catalog";
import { Button } from "@getrunbase/ui/components/ui/button";
import { IconTile } from "@/components/ds/atoms";

// First sentence of the catalog excerpt: fallback for a template without
// a home blurb (`home.templates.items.<slug>`).
const firstSentence = (s: string) =>
  s.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? s;

// Catalog templates (home): name, result in one line, import flow.
export async function TemplateGallery({
  templates,
  collapsed,
}: {
  templates: TemplateSummary[];
  // Workspace with content: a closed "Templates" disclosure.
  collapsed: boolean;
}) {
  const t = await getTranslations("home.templates");
  // Slug-keyed blurbs: dynamic key, checked with `has` first.
  const key = (slug: string) => `items.${slug}` as "items.crm-light";
  const blurb = (tpl: TemplateSummary) =>
    t.has(key(tpl.slug)) ? t(key(tpl.slug)) : firstSentence(tpl.excerpt);
  const grid =
    templates.length === 0 ? (
      <p className="text-muted-foreground text-sm">{t("empty")}</p>
    ) : (
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((tpl) => (
          <li
            key={tpl.id}
            className="flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex items-center gap-3">
              <IconTile
                icon={LayoutTemplate}
                tone="blue"
                className="size-7 rounded-md [&_svg]:size-3.5"
              />
              <h3 className="truncate text-sm font-semibold">{tpl.name}</h3>
            </div>
            <p className="text-muted-foreground flex-1 text-sm">{blurb(tpl)}</p>
            <Button
              asChild
              size="sm"
              variant="secondary"
              className="self-start"
            >
              <Link
                href={`/templates/import?template=${encodeURIComponent(tpl.id)}`}
              >
                <ArrowRight />
                {t("use")}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    );
  if (collapsed)
    return (
      <details id="templates" className="group rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          {t("browse")}
        </summary>
        <div className="flex flex-col gap-3 pt-3">
          <p className="text-muted-foreground text-sm">{t("description")}</p>
          {grid}
        </div>
      </details>
    );
  return (
    <section id="templates" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      {grid}
    </section>
  );
}
