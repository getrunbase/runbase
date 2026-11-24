import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { pagesService } from "@runbase/core/pages";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { IconTile } from "@/components/ds/atoms";
import { getTenant } from "@/lib/tenant";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("pages");

// Workspace pages: entry point for end users.
export default async function Pages() {
  const t = await getTranslations("pages.list");
  const { ctx } = await getTenant({ pages: true });
  const pages = await pagesService.list(ctx);
  return (
    <main className="flex flex-1 flex-col gap-6 px-12 py-8">
      <PageHeader title={t("title")} description={t("description")} />
      {pages.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title={t("empty")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((p) => (
            <Link
              key={p.id}
              href={`/p/${p.id}`}
              className="bg-background hover:bg-secondary flex items-center gap-3 rounded-lg border p-4 transition-colors"
            >
              <IconTile icon={LayoutDashboard} tone="purple" size="node" />
              <span className="text-foreground truncate text-sm font-medium">
                {p.name}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
