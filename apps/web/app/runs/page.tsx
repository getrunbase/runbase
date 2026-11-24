import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { runsService } from "@getrunbase/core/runs";
import { workflowsService } from "@getrunbase/core/workflows";
import { History } from "lucide-react";
import { cn } from "cn";
import { Kpi } from "@/components/ds/atoms";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import { FilterBar } from "@/components/filter-bar";
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
import { makeLabels } from "../workflows/labels";
import { runTone } from "./status-tone";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("runs");

const STATUSES = [
  "running",
  "waiting",
  "succeeded",
  "failed",
  "paused_budget",
  "paused",
  "canceled",
] as const;
type Q = {
  status?: string;
  workflow?: string;
  record?: string;
  cursor?: string;
};

const DAY = 24 * 3600 * 1000;
type Counts = Partial<Record<(typeof STATUSES)[number], number>>;
const total = (c: Counts) => Object.values(c).reduce((a, n) => a + (n ?? 0), 0);
// Success rate over finished runs (null if none).
const rate = (c: Counts) => {
  const done = (c.succeeded ?? 0) + (c.failed ?? 0);
  return done ? (c.succeeded ?? 0) / done : null;
};

// Run list, SGuJK board: 24 h KPIs, statuses as tabs,
// workflow / record filters, table.
export default async function Runs({
  searchParams,
}: {
  searchParams: Promise<Q>;
}) {
  const { ctx } = await getTenant();
  const t = await getTranslations("runs.list");
  const { status: statusLabel } = makeLabels(
    await getTranslations("workflows"),
  );
  const format = await getFormatter();
  const q = await searchParams;
  const status = STATUSES.find((s) => s === q.status);
  const record = q.record?.trim() || undefined;
  const now = new Date();
  const since = new Date(now.getTime() - DAY);
  const before = new Date(now.getTime() - 2 * DAY);
  const [{ items: runs, nextCursor }, workflows, day, prev] = await Promise.all(
    [
      runsService.list(ctx, {
        status,
        workflowId: q.workflow || undefined,
        recordId: record,
        cursor: q.cursor,
      }),
      workflowsService.list(ctx),
      runsService.statusCounts(ctx, since, now),
      runsService.statusCounts(ctx, before, since),
    ],
  );
  const pct = (n: number) =>
    format.number(n, { style: "percent", maximumFractionDigits: 1 });
  const dayTotal = total(day);
  const prevTotal = total(prev);
  const dayRate = rate(day);
  const prevRate = rate(prev);
  const rateDelta =
    dayRate !== null && prevRate !== null ? (dayRate - prevRate) * 100 : null;
  // Status tab: keeps the other filters, goes back to page 1.
  const statusHref = (s?: string) => {
    const p = new URLSearchParams(
      Object.entries({ workflow: q.workflow, record, status: s }).filter(
        (e): e is [string, string] => !!e[1],
      ),
    );
    return `?${p}`;
  };
  const cols = {
    id: "w-25",
    status: "w-27.5",
    steps: "w-37.5",
    duration: "w-20 text-right",
    cost: "w-22.5 text-right",
    date: "w-35",
  };
  return (
    <main className="flex flex-1 flex-col gap-6 px-10 py-8">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label={t("kpi.runs")}
          value={format.number(dayTotal)}
          delta={
            prevTotal
              ? t("kpi.vsYesterday", {
                  delta: format.number((dayTotal - prevTotal) / prevTotal, {
                    style: "percent",
                    signDisplay: "exceptZero",
                    maximumFractionDigits: 0,
                  }),
                })
              : undefined
          }
          deltaTone={dayTotal >= prevTotal ? "green" : "red"}
        />
        <Kpi
          label={t("kpi.successRate")}
          value={dayRate === null ? "—" : pct(dayRate)}
          delta={
            rateDelta === null
              ? undefined
              : t("kpi.ptsVsYesterday", {
                  delta: format.number(rateDelta, {
                    signDisplay: "exceptZero",
                    maximumFractionDigits: 1,
                  }),
                })
          }
          deltaTone={rateDelta !== null && rateDelta < 0 ? "red" : "green"}
        />
        <Kpi
          label={t("kpi.failed")}
          value={format.number(day.failed ?? 0)}
          delta={t("kpi.last24h")}
          deltaTone="neutral"
        />
        <Kpi
          label={t("kpi.waiting")}
          value={format.number(day.waiting ?? 0)}
          delta={t("kpi.last24h")}
          deltaTone="neutral"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <nav
          aria-label={t("filters.status")}
          className="flex flex-1 flex-wrap gap-1"
        >
          {[undefined, ...STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={statusHref(s)}
              aria-current={status === s ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1 text-sm",
                status === s
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {s ? statusLabel(s) : t("filters.all")}
            </Link>
          ))}
        </nav>
        <FilterBar
          filters={[
            {
              key: "workflow",
              label: t("filters.workflow"),
              options: workflows.map((w) => ({ value: w.id, label: w.name })),
            },
          ]}
          search={{ key: "record", placeholder: t("filters.record") }}
        />
      </div>
      {runs.length === 0 ? (
        <EmptyState
          icon={History}
          title={t("empty.title")}
          description={t("empty.description")}
        >
          <Button asChild variant="outline">
            <Link href="/workflows">{t("empty.cta")}</Link>
          </Button>
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={cols.id}>{t("table.run")}</TableHead>
              <TableHead>{t("table.workflow")}</TableHead>
              <TableHead className={cols.status}>{t("table.status")}</TableHead>
              <TableHead className={cols.steps}>{t("table.steps")}</TableHead>
              <TableHead className={cols.duration}>
                {t("table.duration")}
              </TableHead>
              <TableHead className={cols.cost}>{t("table.cost")}</TableHead>
              <TableHead className={cols.date}>{t("table.started")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-muted-foreground">
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/runs/${r.id}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {r.id.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell>{r.workflowName}</TableCell>
                <TableCell>
                  <Badge variant={runTone(r.status)}>
                    {statusLabel(r.status)}
                  </Badge>
                </TableCell>
                <TableCell>{format.number(r.stepCount)}</TableCell>
                <TableCell className="text-right">
                  {r.finishedAt
                    ? format.number(
                        (r.finishedAt.getTime() - r.createdAt.getTime()) / 1000,
                        {
                          style: "unit",
                          unit: "second",
                          maximumFractionDigits: 1,
                        },
                      )
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {format.number(r.cost, {
                    style: "currency",
                    currency: "USD",
                    minimumFractionDigits: 4,
                  })}
                </TableCell>
                <TableCell>{format.relativeTime(r.createdAt, now)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pager params={q} nextCursor={nextCursor} />
    </main>
  );
}
