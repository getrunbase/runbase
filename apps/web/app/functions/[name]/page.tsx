import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { functionsService } from "@getrunbase/core/functions";
import { secretsService } from "@getrunbase/core/secrets";
import { FileCode } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@getrunbase/ui/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@getrunbase/ui/components/ui/tabs";
import { isAdminRole } from "@/lib/roles";
import { getTenant } from "@/lib/tenant";
import { restoreFunction } from "../actions";
import { FunctionForm } from "../function-form";
import { TestPanel } from "../test-panel";
import { pageTitle } from "@/lib/page-title";
import { ActionForm } from "@/components/action-form";

export const generateMetadata = pageTitle("function");

// Function: editing (new version) and history with restore
// (E6ZWDE board).
export default async function FunctionPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { ctx, role } = await getTenant();
  // Save, test and restore: admins only (checked by the core).
  const isAdmin = isAdminRole(role);
  const t = await getTranslations("functions.detail");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const { name } = await params;
  const [versions, secrets] = await Promise.all([
    functionsService.versions(ctx, name),
    secretsService.list(ctx),
  ]);
  const latest = versions.at(-1);
  if (!latest) notFound();
  return (
    <main className="flex flex-1 flex-col gap-5 px-10 py-8">
      <PageHeader
        title={name}
        description={t("subtitle", { version: latest.version })}
      />
      <Tabs defaultValue="code" className="gap-5">
        <TabsList>
          <TabsTrigger value="code">{t("code")}</TabsTrigger>
          <TabsTrigger value="versions">{t("versions")}</TabsTrigger>
        </TabsList>
        <TabsContent value="code" className="flex flex-wrap gap-5">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border">
            <div className="h-topbar flex items-center gap-2.5 border-b pr-2 pl-4">
              <FileCode className="size-3.5" />
              <span className="font-mono text-sm font-medium">
                {t("fileName", { name })}
              </span>
            </div>
            <div className="p-4">
              <FunctionForm
                key={latest.version}
                fn={latest}
                secrets={secrets.map((s) => s.name)}
                readOnly={!isAdmin}
              />
            </div>
          </section>
          {isAdmin && (
            <section className="flex w-95 flex-col gap-2.5 self-start rounded-lg border p-4">
              <TestPanel name={name} version={latest.version} />
            </section>
          )}
        </TabsContent>
        <TabsContent value="versions">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-30">{t("version")}</TableHead>
                <TableHead>{t("createdAt")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {versions.toReversed().map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-sm">
                    v{v.version}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format.dateTime(v.createdAt, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && v.version !== latest.version && (
                      <ActionForm action={restoreFunction}>
                        <input type="hidden" name="name" value={name} />
                        <input type="hidden" name="version" value={v.version} />
                        <Button size="sm" variant="secondary">
                          {tc("restore")}
                        </Button>
                      </ActionForm>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </main>
  );
}
