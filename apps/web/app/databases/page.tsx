import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { databasesService } from "@getrunbase/core/databases";
import { objectsService } from "@getrunbase/core/objects";
import { Database } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { AgentPrompts } from "@/components/agent-prompts";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Card } from "@getrunbase/ui/components/ui/card";
import { isAdminRole } from "@/lib/roles";
import { getTenant } from "@/lib/tenant";
import { ImportTemplateDialog } from "./import-template-dialog";
import { NewDatabaseDialog } from "./new-database-dialog";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("databases");

// Workspace databases.
export default async function Databases() {
  const t = await getTranslations("databases");
  const { ctx, role } = await getTenant();
  // Creating databases and importing templates: admins only.
  const isAdmin = isAdminRole(role);
  const [dbs, objects] = await Promise.all([
    databasesService.list(ctx),
    objectsService.list(ctx),
  ]);
  const names = new Map(dbs.map((d) => [d.id, d.name]));
  const targets = objects.map((o) => ({
    slug: o.slug,
    name: o.name,
    database: names.get(o.databaseId) ?? "",
  }));
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <PageHeader title={t("list.title")} description={t("list.description")}>
        {isAdmin && <ImportTemplateDialog />}
        {isAdmin && <NewDatabaseDialog targets={targets} />}
      </PageHeader>
      {dbs.length === 0 ? (
        <EmptyState
          icon={Database}
          title={t("list.empty")}
          description={t("list.emptyDescription")}
        >
          <AgentPrompts group="databases" />
          {isAdmin && <NewDatabaseDialog targets={targets} />}
        </EmptyState>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {dbs.map((d) => (
            <Link
              key={d.id}
              href={`/databases/${d.slug}`}
              className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 text-sm"
            >
              <Database className="text-muted-foreground size-4" />
              <span className="flex-1 font-medium">{d.name}</span>
              <Badge variant="secondary">
                {t("list.objects", {
                  count: objects.filter((o) => o.databaseId === d.id).length,
                })}
              </Badge>
            </Link>
          ))}
        </Card>
      )}
    </main>
  );
}
