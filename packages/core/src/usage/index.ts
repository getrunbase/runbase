// Metered usage reported to the billing extension (BillingProvider.reportUsage):
// per workspace, current record count, runs started this calendar month (UTC)
// and bytes of attached files. Reported as absolute values (gauges), so a
// missed or repeated report is harmless. Started by a BullMQ job scheduler,
// only when an extension module is loaded: self-host reports nothing.
import { Queue, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { busConnection } from "../bus";
import { db } from "../db/client";
import { env } from "../env";
import { getExtensions } from "../extensions";
import { logger } from "../logger";

export const USAGE_METRICS = ["records", "runs", "storageBytes"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];
export type WorkspaceUsage = { workspaceId: string } & Record<UsageMetric, number>;

const monthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// One aggregate query per metric over all workspaces (or the given ones).
export async function collectUsage(
  opts: { now?: Date; workspaceIds?: string[] } = {},
): Promise<WorkspaceUsage[]> {
  const since = monthStart(opts.now ?? new Date()).toISOString();
  const only = opts.workspaceIds;
  if (only && !only.length) return [];
  const filter = (col: ReturnType<typeof sql.raw>) =>
    only
      ? sql`and ${col} in (${sql.join(only.map((id) => sql`${id}::uuid`), sql`, `)})`
      : sql``;
  const rows = await db.execute<{
    workspace_id: string;
    records: string | number | null;
    runs: string | number | null;
    storage: string | number | null;
  }>(sql`
    select w.id as workspace_id,
      coalesce(u.records, 0) as records,
      coalesce(r.n, 0) as runs,
      coalesce(f.bytes, 0) as storage
    from workspaces w
    left join workspace_usage u on u.workspace_id = w.id
    left join (
      select workspace_id, count(*) as n from workflow_runs
      where created_at >= ${since} ${filter(sql.raw("workspace_id"))}
      group by workspace_id
    ) r on r.workspace_id = w.id
    left join (
      -- Attached files: { key, size } objects anywhere in record data, whose
      -- key belongs to the workspace (see ../files).
      select rec.workspace_id, sum((v->>'size')::bigint) as bytes
      from records rec, jsonb_path_query(rec.data, 'strict $.**') v
      where jsonb_typeof(v) = 'object' and v ? 'key'
        and jsonb_typeof(v->'size') = 'number'
        and v->>'key' like rec.workspace_id::text || '/%'
        ${filter(sql.raw("rec.workspace_id"))}
      group by rec.workspace_id
    ) f on f.workspace_id = w.id
    where true ${filter(sql.raw("w.id"))}
    order by w.id`);
  return [...rows].map((r) => ({
    workspaceId: r.workspace_id,
    records: Number(r.records ?? 0),
    runs: Number(r.runs ?? 0),
    storageBytes: Number(r.storage ?? 0),
  }));
}

export type UsageReport = { workspaces: number; reported: number; failed: number };

// Best effort: a failing report is logged and the next ones still go out.
export async function reportUsage(
  opts: { now?: Date; workspaceIds?: string[] } = {},
): Promise<UsageReport> {
  const billing = getExtensions().billing;
  const usage = await collectUsage(opts);
  const out: UsageReport = { workspaces: usage.length, reported: 0, failed: 0 };
  for (const u of usage)
    for (const metric of USAGE_METRICS) {
      try {
        await billing.reportUsage(u.workspaceId, metric, u[metric]);
        out.reported++;
      } catch (err) {
        out.failed++;
        logger.warn({ err, workspaceId: u.workspaceId, metric }, "usage report failed");
      }
    }
  return out;
}

export const USAGE_QUEUE = "usage";

// Fixed scheduler id: idempotent upsert from each worker, one job per due date.
export function startUsageWorker() {
  const queue = new Queue(USAGE_QUEUE, { connection: busConnection() });
  void queue
    .upsertJobScheduler(
      "usage",
      { pattern: env().USAGE_REPORT_CRON },
      { name: "usage" },
    )
    .catch((err) => logger.error({ err }, "usage scheduler failed"))
    .finally(() => void queue.close());
  return new Worker(
    USAGE_QUEUE,
    async () => {
      const r = await reportUsage();
      if (r.failed) logger.warn(r, "usage reported with failures");
      return r;
    },
    { connection: busConnection(), concurrency: 1 },
  );
}
