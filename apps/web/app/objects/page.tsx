import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { objectsService } from "@getrunbase/core/objects";
import { Boxes } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Card } from "@getrunbase/ui/components/ui/card";
import { getTenant } from "@/lib/tenant";
import { NewObjectDialog } from "./new-object-dialog";
import { relationTargets } from "./targets";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("objects");

// Workspace object list and creation.
export default async function Objects() {
  const t = await getTranslations("objects");
  const { ctx } = await getTenant();
  const [list, targets] = await Promise.all([
    objectsService.list(ctx),
    relationTargets(ctx),
  ]);
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <PageHeader title={t("list.title")} description={t("list.description")}>
        <NewObjectDialog targets={targets} />
      </PageHeader>
      {list.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={t("list.empty")}
          description={t("list.emptyDescription")}
        >
          <NewObjectDialog targets={targets} />
        </EmptyState>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {list.map((o) => (
            <Link
              key={o.id}
              href={`/objects/${o.slug}`}
              className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 text-sm"
            >
              <Boxes className="text-muted-foreground size-4" />
              <span className="flex-1 font-medium">{o.name}</span>
              <Badge variant="secondary">
                {t("list.fields", { count: (o.fields as unknown[]).length })}
              </Badge>
            </Link>
          ))}
        </Card>
      )}
    </main>
  );
}
