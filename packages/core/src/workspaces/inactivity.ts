// Inactivity policy runner: asks the `inactivity` extension, for each active
// workspace, whether to pause it or warn first, and applies the decision.
// Resume stays on next activity (activity.ts). Started by a BullMQ job
// scheduler, only when an extension module is loaded: self-host never pauses.
import { Queue, Worker } from "bullmq";
import { eq, isNull } from "drizzle-orm";
import { busConnection } from "../bus";
import { db } from "../db/client";
import { workspaces } from "../db/schema";
import { env } from "../env";
import { getExtensions } from "../extensions";
import { logger } from "../logger";
import { pauseWorkspace } from "./activity";

export type InactivityReport = { checked: number; paused: number; warned: number; failed: number };

// ponytail: scans every active workspace each run, page it if the count grows large.
export async function applyInactivityPolicy(now = new Date()): Promise<InactivityReport> {
  const policy = getExtensions().inactivity;
  const rows = await db
    .select({
      id: workspaces.id,
      organizationId: workspaces.organizationId,
      lastActiveAt: workspaces.lastActiveAt,
      createdAt: workspaces.createdAt,
      warnedAt: workspaces.warnedAt,
    })
    .from(workspaces)
    .where(isNull(workspaces.pausedAt));
  const out: InactivityReport = { checked: rows.length, paused: 0, warned: 0, failed: 0 };
  for (const w of rows) {
    try {
      const { action } = await policy.decide({
        workspaceId: w.id,
        organizationId: w.organizationId,
        lastActivityAt: (w.lastActiveAt ?? w.createdAt).toISOString(),
        paused: false,
        warnedAt: w.warnedAt?.toISOString() ?? null,
        now: now.toISOString(),
      });
      if (action === "pause") {
        await pauseWorkspace(w.id);
        out.paused++;
      } else if (action === "warn") {
        await db.update(workspaces).set({ warnedAt: now }).where(eq(workspaces.id, w.id));
        out.warned++;
      }
    } catch (err) {
      out.failed++;
      logger.warn({ err, workspaceId: w.id }, "inactivity policy failed");
    }
  }
  return out;
}

export const INACTIVITY_QUEUE = "inactivity";

export function startInactivityWorker() {
  const queue = new Queue(INACTIVITY_QUEUE, { connection: busConnection() });
  void queue
    .upsertJobScheduler("inactivity", { pattern: env().INACTIVITY_CRON }, { name: "inactivity" })
    .catch((err) => logger.error({ err }, "inactivity scheduler failed"))
    .finally(() => void queue.close());
  return new Worker(
    INACTIVITY_QUEUE,
    async () => {
      const r = await applyInactivityPolicy();
      if (r.paused || r.warned || r.failed) logger.info(r, "inactivity policy applied");
      return r;
    },
    { connection: busConnection(), concurrency: 1 },
  );
}
