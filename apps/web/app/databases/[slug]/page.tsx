import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { databasesService } from "@getrunbase/core/databases";
import { fieldsSchema } from "@getrunbase/core/objects";
import { ArrowUpRight, Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { IconTile } from "@/components/ds/atoms";
import { PageIcon } from "@/components/page-icon";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@getrunbase/ui/components/ui/tabs";
import { isAdminRole } from "@/lib/roles";
import { getTenant } from "@/lib/tenant";
import { SchemaGraph, type SchemaObject } from "./schema-graph-lazy";
import { NewObjectDialog } from "../../objects/new-object-dialog";
import { relationTargets } from "../../objects/targets";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("database");

// Database page: objects and record counts, object creation,
// schema view (ERD diagram of the objects and their relations).
export default async function DatabasePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("databases");
  const tObjects = await getTranslations("objects");
  const { ctx, role } = await getTenant();
  // Creating objects: admins only.
  const isAdmin = isAdminRole(role);
  const [db, targets] = await Promise.all([
    databasesService.get(ctx, slug),
    relationTargets(ctx),
  ]);
  if (!db) notFound();
  const objects = db.objects.map((o) => ({
    ...o,
    fields: fieldsSchema.parse(o.fields),
  }));
  // Database objects + relation targets outside the database (dashed).
  const own = new Set(objects.map((o) => o.slug));
  const external = [
    ...new Set(
      objects.flatMap((o) =>
        o.fields.flatMap((f) =>
          (f.type === "ref" || f.type === "refs") && !own.has(f.object)
            ? [f.object]
            : [],
        ),
      ),
    ),
  ];
  const schema: SchemaObject[] = [
    ...objects.map((o) => ({ slug: o.slug, name: o.name, fields: o.fields })),
    ...external.map((slug) => {
      const t = targets.find((x) => x.slug === slug);
      return {
        slug,
        name: t?.name ?? slug,
        external: t?.database || "?",
        fields: [],
      };
    }),
  ];

  return (
    <main className="flex flex-1 flex-col gap-5 px-10 py-8">
      <PageHeader title={db.name} description={db.description ?? undefined}>
        {isAdmin && <NewObjectDialog database={db.slug} targets={targets} />}
      </PageHeader>
      <Tabs defaultValue="objects" className="gap-5">
        <TabsList>
          <TabsTrigger value="objects">{t("detail.objectsTab")}</TabsTrigger>
          <TabsTrigger value="schema">{t("detail.schemaTab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="objects" className="flex flex-col gap-5">
          {/* Object cards (xLl5q board): 4 columns gap 16, p 16 gap 10, radius 10. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {objects.map((o) => (
              <Link
                key={o.id}
                href={`/objects/${o.slug}`}
                className="bg-background hover:bg-secondary flex flex-col gap-2.5 rounded-lg border p-4"
              >
                <div className="flex items-center gap-2.5">
                  <IconTile
                    tone="blue"
                    icon={<PageIcon name={o.icon ?? "table-2"} />}
                    className="size-7 rounded-md [&_svg]:size-3.75"
                  />
                  <span className="text-foreground flex-1 truncate text-base font-semibold">
                    {o.name}
                  </span>
                  <ArrowUpRight className="text-subtle-foreground size-3.5" />
                </div>
                <div className="text-subtle-foreground flex gap-3 pt-1 text-xs">
                  <span>
                    {t("detail.attributes", { count: o.fields.length })}
                  </span>
                  <span>{t("detail.records", { count: o.records })}</span>
                </div>
              </Link>
            ))}
            {isAdmin && (
              <NewObjectDialog
                database={db.slug}
                targets={targets}
                trigger={
                  <button
                    type="button"
                    className="text-muted-foreground hover:bg-secondary flex h-32.75 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-input text-sm"
                  >
                    <Plus className="size-4" />
                    {tObjects("new")}
                  </button>
                }
              />
            )}
          </div>
          <div className="bg-tag-purple-bg text-tag-purple-fg flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm">
            <Sparkles className="size-3.75 shrink-0" />
            <span className="flex-1">{t("detail.agentHint")}</span>
          </div>
        </TabsContent>
        <TabsContent value="schema">
          <SchemaGraph objects={schema} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
