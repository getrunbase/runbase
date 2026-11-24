import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { errorsService, type ErrorRow } from "@getrunbase/core/errors";
import { FilterBar } from "@/components/filter-bar";
import { CircleCheck, CircleCheckBig, OctagonAlert } from "lucide-react";
import { cn } from "cn";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@getrunbase/ui/components/ui/table";
import { Pager } from "@/components/pager";
import { getTenant } from "@/lib/tenant";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("errors");

const SOURCES = ["ingest", "workflow", "function", "mcp"] as const;
const STATUSES = ["open", "resolved"] as const;

// Workspace "Errors" screen, source / status filters.
export default async function Errors({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; status?: string; cursor?: string }>;
}) {
  const { ctx } = await getTenant();
  const t = await getTranslations("runs.errors");
  const format = await getFormatter();
  const q = await searchParams;
  const now = new Date();
  const source = SOURCES.find((s) => s === q.source);
  const status = STATUSES.find((s) => s === q.status);
  const { items: list, nextCursor } = await errorsService.list(ctx, {
    source,
    status,
    cursor: q.cursor,
  });
  return (
    <main className="flex flex-1 flex-col gap-6 px-10 py-8">
      <PageHeader title={t("title")} description={t("description")} />
      <FilterBar
        filters={[
          {
            key: "source",
            label: t("filters.source"),
            options: SOURCES.map((s) => ({ value: s, label: s })),
          },
          {
            key: "status",
            label: t("filters.status"),
            options: STATUSES.map((s) => ({
              value: s,
              label: t(`status.${s}`),
            })),
          },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState
          icon={CircleCheckBig}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.error")}</TableHead>
              <TableHead className="w-45">{t("table.source")}</TableHead>
              <TableHead className="w-27.5">{t("table.status")}</TableHead>
              <TableHead className="w-30">{t("table.date")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((e: ErrorRow) => {
              const open = e.status === "open";
              const Icon = open ? OctagonAlert : CircleCheck;
              return (
                <TableRow key={e.id} className="h-10">
                  <TableCell className="max-w-0">
                    <Link
                      href={`/errors/${e.id}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
                          open ? "text-destructive" : "text-subtle-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "truncate font-mono text-xs",
                          !open && "text-subtle-foreground",
                        )}
                      >
                        {e.message}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.source}
                  </TableCell>
                  <TableCell>
                    <Badge variant={open ? "red" : "green"}>
                      {t(`status.${e.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.relativeTime(e.createdAt, now)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Pager params={q} nextCursor={nextCursor} />
    </main>
  );
}
