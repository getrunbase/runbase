// Workflow Runs tab (mTVU3 board): 30-day indicators,
// status filter, runs table.
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { runsService } from "@runbase/core/runs";
import { History } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { Badge } from "@runbase/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@runbase/ui/components/ui/table";
import type { TenantContext } from "@runbase/core/tenant";
import { makeLabels } from "../labels";

const STATUSES = [
  "running",
  "waiting",
  "succeeded",
  "failed",
  "paused_budget",
  "paused",
  "canceled",
] as const;

// Status colour (board: Running blue, Awaiting approval yellow, Succeeded
// green, Failed red, Skipped purple).
const TONE = {
  running: "blue",
  waiting: "yellow",
  succeeded: "green",
  failed: "red",
  paused_budget: "orange",
  paused: "orange",
  canceled: "purple",
} as const;

const DAY = 24 * 60 * 60 * 1000;

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

export async function RunsTab({
  ctx,
  workflowId,
  status: rawStatus,
}: {
  ctx: TenantContext;
  workflowId: string;
  status?: string;
}) {
  const t = await getTranslations("workflows.runs");
  const { status: statusLabel } = makeLabels(
    await getTranslations("workflows"),
  );
  const format = await getFormatter();
  const now = new Date();
  const status = STATUSES.find((s) => s === rawStatus);
  const from = new Date(Date.now() - 30 * DAY);
  const [{ items: month }, { items: runs }] = await Promise.all([
    runsService.list(ctx, { workflowId, from, limit: 200 }),
    runsService.list(ctx, { workflowId, status, limit: 50 }),
  ]);
  const done = month.filter((r) => r.finishedAt);
  const failed = month.filter((r) => r.status === "failed").length;
  const ended = month.filter(
    (r) => r.status === "succeeded" || r.status === "failed",
  ).length;
  const durations = done.map(
    (r) => (r.finishedAt!.getTime() - r.createdAt.getTime()) / 1000,
  );
  const median = quantile(durations, 0.5);
  const p95 = quantile(durations, 0.95);
  const seconds = (s: number) =>
    format.number(s, {
      style: "unit",
      unit: "second",
      maximumFractionDigits: 1,
    });
  const stats = [
    {
      label: t("stats.runs"),
      value: format.number(month.length),
      sub: t("stats.runsSub", { count: done.length }),
    },
    {
      label: t("stats.success"),
      value: ended
        ? format.number((ended - failed) / ended, {
            style: "percent",
            maximumFractionDigits: 1,
          })
        : "—",
      sub: t("stats.failures", { count: failed }),
    },
    {
      label: t("stats.median"),
      value: median === null ? "—" : seconds(median),
      sub: p95 === null ? "" : t("stats.p95", { value: seconds(p95) }),
    },
  ];
  return (
    <div className="flex flex-1 flex-col gap-6 px-12 py-8">
      <div className="flex flex-wrap gap-12">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">{s.label}</span>
            <span className="text-2xl font-semibold tabular-nums">
              {s.value}
            </span>
            <span className="text-subtle-foreground text-xs">{s.sub}</span>
          </div>
        ))}
      </div>
      <div className="border-t pt-6">
        <FilterBar
          filters={[
            {
              key: "status",
              label: t("filters.status"),
              options: STATUSES.map((s) => ({
                value: s,
                label: statusLabel(s),
              })),
            },
          ]}
        />
      </div>
      {runs.length === 0 ? (
        <EmptyState
          icon={History}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-27.5 font-normal">
                {t("table.run")}
              </TableHead>
              <TableHead className="w-32.5 font-normal">
                {t("table.status")}
              </TableHead>
              <TableHead className="font-normal">
                {t("table.summary")}
              </TableHead>
              <TableHead className="w-17.5 font-normal">
                {t("table.version")}
              </TableHead>
              <TableHead className="w-22.5 font-normal">
                {t("table.duration")}
              </TableHead>
              <TableHead className="w-35 font-normal">
                {t("table.started")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/runs/${r.id}`} className="font-medium">
                    #{r.id.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={TONE[r.status as keyof typeof TONE] ?? "neutral"}
                  >
                    {statusLabel(r.status)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-0 truncate">
                  {r.error ?? t("summary", { count: r.stepCount })}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  v{r.version}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono">
                  {r.finishedAt
                    ? seconds(
                        (r.finishedAt.getTime() - r.createdAt.getTime()) / 1000,
                      )
                    : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {format.relativeTime(r.createdAt, now)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
