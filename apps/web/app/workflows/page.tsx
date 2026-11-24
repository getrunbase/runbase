import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { workflowsService } from "@runbase/core/workflows";
import { Plus, Workflow } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@runbase/ui/components/ui/badge";
import { Button } from "@runbase/ui/components/ui/button";
import { Input } from "@runbase/ui/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@runbase/ui/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@runbase/ui/components/ui/tabs";
import { getTenant } from "@/lib/tenant";
import { createWorkflow } from "./actions";
import { makeLabels } from "./labels";
import { workflowStatusVariant } from "./[id]/workflow-bar";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("workflows");

const FILTERS = ["all", "active", "paused", "draft"] as const;

// Workflow list and creation, c6W4Pn board.
export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { ctx } = await getTenant();
  const sp = await searchParams;
  const all = await workflowsService.list(ctx);
  // Displayed trigger: definition of the current version of each workflow.
  const triggers = new Map(
    await Promise.all(
      all.map(
        async (w) =>
          [
            w.id,
            String(
              (await workflowsService.get(ctx, w.id))?.definition.trigger
                .type ?? "",
            ),
          ] as const,
      ),
    ),
  );
  const t = await getTranslations("workflows");
  const format = await getFormatter();
  const now = new Date();
  const l = makeLabels(t);
  const filter = FILTERS.find((f) => f === sp.status) ?? "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const workflows = all
    .filter((w) => filter === "all" || w.status === filter)
    .filter((w) => !q || w.name.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const href = (status: string) => {
    const p = new URLSearchParams();
    if (status !== "all") p.set("status", status);
    if (sp.q) p.set("q", sp.q);
    const s = p.toString();
    return s ? `/workflows?${s}` : "/workflows";
  };
  return (
    <main className="flex flex-1 flex-col gap-6 px-12 py-8">
      <PageHeader title={t("list.title")} description={t("list.description")}>
        <form action={createWorkflow} className="flex gap-2">
          <Input
            name="name"
            placeholder={t("list.namePlaceholder")}
            aria-label={t("list.namePlaceholder")}
            required
            className="w-56"
          />
          <Button type="submit">
            <Plus />
            {t("list.create")}
          </Button>
        </form>
      </PageHeader>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={filter}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f} value={f} asChild>
                <Link href={href(f)}>
                  {f === "all"
                    ? t("list.filters.all", { count: all.length })
                    : t(`list.filters.${f}`)}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <form className="w-65">
          {filter !== "all" && (
            <input type="hidden" name="status" value={filter} />
          )}
          <Input
            name="q"
            defaultValue={sp.q}
            placeholder={t("list.search")}
            aria-label={t("list.search")}
          />
        </form>
      </div>
      {all.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title={t("list.emptyTitle")}
          description={t("list.emptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("list.table.name")}</TableHead>
                <TableHead className="w-35">{t("list.table.status")}</TableHead>
                <TableHead className="w-40">
                  {t("list.table.trigger")}
                </TableHead>
                <TableHead className="w-35">
                  {t("list.table.updated")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.map((w) => (
                <TableRow key={w.id} className="relative h-11">
                  <TableCell>
                    <Link
                      href={`/workflows/${w.id}`}
                      className="font-medium after:absolute after:inset-0"
                    >
                      {w.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={workflowStatusVariant(w.status)}>
                      {l.status(w.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {triggers.get(w.id) ? l.trigger(triggers.get(w.id)!) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.relativeTime(w.updatedAt, now)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <span className="text-muted-foreground text-xs">
            {t("list.count", { shown: workflows.length, total: all.length })}
          </span>
        </div>
      )}
    </main>
  );
}
