import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/tenant";
import { getTranslations } from "next-intl/server";
import { Table2, Workflow, type LucideIcon } from "lucide-react";
import { catalogService } from "@runbase/core/catalog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { IconTile } from "@/components/ds/atoms";
import type { Tone } from "@/components/ds/tone";
import { CatalogImportForm } from "./import-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("templateImport");

type Item = {
  key: string;
  icon: LucideIcon;
  tone: Tone;
  name: string;
  detail: string;
  type: string;
};

const list = (v: unknown) =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

// Import of a catalog template from the website (/templates/import?template=<id>):
// sign-in or sign-up first (back here via `next`), then confirmation
// (a GET never imports anything). v1vg3 board.
export default async function CatalogImport({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template } = await searchParams;
  if (!template) notFound();
  if (!(await getSession()))
    redirect(
      `/login?next=${encodeURIComponent(`/templates/import?template=${encodeURIComponent(template)}`)}`,
    );
  const t = await getTranslations("databases.catalogImport");
  const found = await catalogService.getTemplate(template).catch(() => null);
  if (!found)
    return (
      <main className="flex flex-1 flex-col gap-6 px-12 py-8">
        <Alert variant="destructive" className="max-w-xl">
          <AlertDescription>{t("notFound")}</AlertDescription>
        </Alert>
      </main>
    );
  // What the import will create, read from the template manifest.
  const items: Item[] = [
    ...list(found.manifest.workflows).map((w, i) => ({
      key: `w${i}`,
      icon: Workflow,
      tone: "orange" as const,
      name: String(w.name ?? w.key ?? ""),
      detail: t("workflowDetail"),
      type: t("types.workflow"),
    })),
    ...list(found.manifest.objects).map((o, i) => ({
      key: `o${i}`,
      icon: Table2,
      tone: "blue" as const,
      name: String(o.name ?? o.slug ?? ""),
      detail: t("objectDetail", { count: list(o.fields).length }),
      type: t("types.object"),
    })),
  ];
  return (
    <main className="flex flex-1 flex-col gap-6 px-12 py-8">
      <PageHeader title={found.name} description={t("description")} />
      <div className="flex flex-1 flex-col gap-8 lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <h2 className="text-foreground text-lg font-semibold">
            {t("created")}
          </h2>
          {items.length > 0 && (
            <div className="flex flex-col rounded-lg border">
              {items.map((it, i) => (
                <div
                  key={it.key}
                  className={
                    i === 0
                      ? "flex items-center gap-3 px-4 py-3"
                      : "flex items-center gap-3 border-t px-4 py-3"
                  }
                >
                  <IconTile
                    icon={it.icon}
                    tone={it.tone}
                    className="size-7 rounded-md [&_svg]:size-3.5"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-foreground truncate text-sm font-medium">
                      {it.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {it.detail}
                    </span>
                  </div>
                  <span className="bg-secondary text-muted-foreground rounded-sm px-1.5 py-0.5 text-xs font-medium">
                    {it.type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="bg-secondary flex w-full flex-col gap-4 rounded-lg border p-6 lg:w-110">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-foreground text-lg font-semibold">
              {t("title", { name: found.name })}
            </h2>
            <p className="text-muted-foreground text-sm">{t("panel")}</p>
          </div>
          <div className="flex-1" />
          <div className="flex flex-col gap-3 border-t pt-4">
            <p className="text-muted-foreground text-xs">{t("info")}</p>
            <CatalogImportForm template={found.id} />
          </div>
        </aside>
      </div>
    </main>
  );
}
