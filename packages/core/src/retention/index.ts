// Retention per organization (quota:retentionDays): purge of finished runs (and their steps,
// by cascade), events, audit log and function logs older
// than the duration set by its entitlements. DELETE in batches (≤ 5,000
// rows) until exhausted, with a pause between batches so as not to monopolize
// the database. Started by a BullMQ job scheduler: a single execution per
// due date, whatever the number of workers. Idempotent: rerun, it only
// deletes what still exceeds the retention.
import { setTimeout as sleep } from "node:timers/promises";
import { Queue, Worker } from "bullmq";
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { busConnection } from "../bus";
import { env } from "../env";
import { quotaOf } from "../entitlements";
import { db } from "../db/client";
import { logger } from "../logger";
import {
  auditLog,
  events,
  functionLogs,
  oauthClient,
  oauthConsent,
  organizations,
  workflowRuns,
} from "../db/schema";

// Retention duration of an organization (days); null = no purge.
export async function retentionDays(organizationId: string) {
  const d = await quotaOf(organizationId, "quota:retentionDays");
  return Number.isFinite(d) ? d : null;
}

export const MAX_BATCH = 5_000;

type Target = {
  name: string;
  table: PgTable & { id: PgColumn; organizationId: PgColumn };
  at: PgColumn;
  // Extra condition: a running run is never purged.
  where?: SQL;
};

const targets: Target[] = [
  {
    name: "workflow_runs",
    table: workflowRuns,
    at: workflowRuns.createdAt,
    where: sql`and ${workflowRuns.finishedAt} is not null`,
  },
  { name: "events", table: events, at: events.occurredAt },
  { name: "audit_log", table: auditLog, at: auditLog.createdAt },
  { name: "function_logs", table: functionLogs, at: functionLogs.createdAt },
];

export type RetentionReport = {
  deleted: Record<string, number>;
  batches: number;
};

export async function purgeRetention(
  opts: {
    batchSize?: number;
    pauseMs?: number;
    now?: Date;
    // Restricts the purge to these organizations (tests); default: all.
    organizationIds?: string[];
  } = {},
): Promise<RetentionReport> {
  const size = Math.min(Math.max(opts.batchSize ?? MAX_BATCH, 1), MAX_BATCH);
  const pauseMs = opts.pauseMs ?? 200;
  const now = opts.now ?? new Date();
  const report: RetentionReport = { deleted: {}, batches: 0 };
  const orgs = opts.organizationIds
    ? opts.organizationIds.map((id) => ({ id }))
    : await db.select({ id: organizations.id }).from(organizations);
  for (const org of orgs) {
    const days = await retentionDays(org.id);
    if (days == null) continue;
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
    for (const t of targets) {
      for (;;) {
        const res =
          await db.execute(sql`delete from ${t.table} where ${t.table.id} in (
          select ${t.table.id} from ${t.table}
          where ${t.table.organizationId} = ${org.id} and ${t.at} < ${cutoff} ${t.where ?? sql``}
          limit ${size})`);
        const n = res.count;
        if (!n) break;
        report.batches++;
        report.deleted[t.name] = (report.deleted[t.name] ?? 0) + n;
        if (n < size) break;
        if (pauseMs) await sleep(pauseMs);
      }
    }
  }
  return report;
}

// OAuth clients registered dynamically (MCP) but never consented to are
// deleted after this delay: open registration would otherwise let the
// table grow without bound. Clients with skip_consent (trusted, created
// by an admin) are kept.
export const OAUTH_CLIENT_TTL_MS = 24 * 3_600_000;

export async function purgeStaleOAuthClients(now = new Date()) {
  const cutoff = new Date(now.getTime() - OAUTH_CLIENT_TTL_MS);
  const res = await db.execute(sql`delete from ${oauthClient}
    where ${oauthClient.createdAt} < ${cutoff.toISOString()}
    and coalesce(${oauthClient.skipConsent}, false) = false
    and not exists (select 1 from ${oauthConsent}
      where ${oauthConsent.clientId} = ${oauthClient.clientId})`);
  return res.count;
}

export const RETENTION_QUEUE = "retention";

// Scheduler with a fixed id: idempotent upsert from each worker, BullMQ creates
// only one job per due date and a single worker processes it.
export function startRetentionWorker() {
  const queue = new Queue(RETENTION_QUEUE, { connection: busConnection() });
  void queue
    .upsertJobScheduler(
      "retention",
      { pattern: env().RETENTION_CRON },
      { name: "retention" },
    )
    .catch((err) => logger.error({ err }, "retention scheduler failed"))
    .finally(() => void queue.close());
  return new Worker(
    RETENTION_QUEUE,
    async () => {
      const r = await purgeRetention();
      if (r.batches) logger.info({ deleted: r.deleted }, "retention purged");
      const oauthClients = await purgeStaleOAuthClients();
      if (oauthClients)
        logger.info({ oauthClients }, "stale OAuth clients purged");
      return { ...r, oauthClients };
    },
    { connection: busConnection(), concurrency: 1 },
  );
}
