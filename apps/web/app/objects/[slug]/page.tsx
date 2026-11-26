import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { objectsService, type Field } from "@getrunbase/core/objects";
import { workflowsService } from "@getrunbase/core/workflows";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@getrunbase/ui/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { isAdminRole } from "@/lib/roles";
import { getTenant } from "@/lib/tenant";
import { MigrateField } from "../migrate-field";
import { SchemaEditor } from "../schema-editor";
import { relationTargets } from "../targets";
import { TrashList } from "./data-tools";
import { RecordsView } from "./record-sheet";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("object");

// Object: records table and schema editor.
export default async function ObjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("objects.detail");
  const { ctx, role } = await getTenant();
  // Schema changes: admins only (checked by the core).
  const isAdmin = isAdminRole(role);
  const object = await objectsService.get(ctx, slug);
  if (!object) notFound();
  const fields = object.fields as Field[];
  const targets = await relationTargets(ctx);
  // Active workflows that can be triggered by hand on a selection.
  const workflows = (
    await Promise.all(
      (await workflowsService.list(ctx))
        .filter((w) => w.status === "active")
        .map((w) => workflowsService.get(ctx, w.id)),
    )
  ).flatMap((w) =>
    w?.definition.trigger?.type === "trigger.manual"
      ? [{ id: w.id, name: w.name }]
      : [],
  );
  return (
    <main className="flex flex-1 flex-col gap-5 px-10 py-8">
      <PageHeader title={object.name} />
      <Tabs defaultValue="records" className="gap-5">
        <TabsList>
          <TabsTrigger value="records">{t("records")}</TabsTrigger>
          {isAdmin && <TabsTrigger value="schema">{t("schema")}</TabsTrigger>}
          <TabsTrigger value="trash">{t("trash")}</TabsTrigger>
        </TabsList>
        <TabsContent value="records">
          <RecordsView
            key={object.updatedAt.toISOString()}
            slug={object.slug}
            objectId={object.id}
            fields={fields}
            workflows={workflows}
          />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="schema" className="max-w-3xl">
            <SchemaEditor
              key={object.updatedAt.toISOString()}
              object={{ id: object.id, name: object.name, fields }}
              targets={targets}
            />
            <MigrateField
              key={`m-${object.updatedAt.toISOString()}`}
              objectId={object.id}
              fields={fields}
            />
          </TabsContent>
        )}
        <TabsContent value="trash">
          <TrashList objectId={object.id} fields={fields} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
