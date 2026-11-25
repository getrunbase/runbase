import { busQueue } from "@getrunbase/core/bus";
import { validateEnv } from "@getrunbase/core/env";
import { loadExtensions, track } from "@getrunbase/core/extensions";
import { createLogger, withContext } from "@getrunbase/core/logger";
import { purgeExpiredRecords } from "@getrunbase/core/records";
import { startRetentionWorker } from "@getrunbase/core/retention";
import { runsQueue, startRunsSweeper, startRunsWorker } from "@getrunbase/core/runs";
import { observeQueue, startMetrics } from "@getrunbase/core/telemetry";
import { scheduleQueue, startTriggerWorkers } from "@getrunbase/core/triggers";
import { startUsageWorker } from "@getrunbase/core/usage";
import { startInactivityWorker } from "@getrunbase/core/workspaces/inactivity";
import { startBoard } from "./board";
import { startTelemetry } from "./telemetry";

// Configuration validated before any startup: clear message if invalid.
validateEnv("worker");
// Extension points: RUNBASE_EXTENSIONS, otherwise no-op.
const extended = await loadExtensions();
const log = createLogger({ service: "worker" });
// OpenTelemetry metrics: no-op without OTEL_METRICS_EXPORTER.
const telemetry = startMetrics("runbase-worker");
for (const q of [runsQueue(), busQueue(), scheduleQueue()]) observeQueue(q);

const workers = [
  ...startTriggerWorkers(),
  startRunsWorker(),
  // Per-organization retention (entitlements): BullMQ cron, one run per due date.
  startRetentionWorker(),
  // Metered usage for the billing extension: self-host (no extension)
  // schedules nothing.
  ...(extended ? [startUsageWorker()] : []),
  // Inactivity policy (pause of idle workspaces): extension only, self-host
  // never pauses.
  ...(extended ? [startInactivityWorker()] : []),
];
// Run outbox sweeper: jobs lost between commit and
// enqueue, or gone from Redis (waits included), re-enqueued periodically.
const sweeper = startRunsSweeper();
// Job failures: correlated JSON log (workspace, run).
for (const w of workers)
  w.on("failed", (job, err) => {
    const data = (job?.data ?? {}) as { workspaceId?: string; runId?: string };
    withContext(
      {
        workspaceId: data.workspaceId,
        runId: data.runId ?? (w.name === "runs" ? job?.id : undefined),
        queue: w.name,
        jobId: job?.id,
        attempts: job?.attemptsMade,
      },
      log,
    ).error({ err }, "job failed");
  });

// Liveness (/healthz): true as long as no worker is stopped.
const board = startBoard(() => !stopping && workers.every((w) => w.isRunning()));
log.info("worker started");
// Daily anonymous telemetry, RUNBASE_TELEMETRY=0 turns it off.
const ping = startTelemetry({ log: { info: (m) => log.info(m) } });
void track("worker.started");
// Record trash: purges deletions older than 30 days, at
// startup then every hour.
const purge = () =>
  purgeExpiredRecords().then(
    (n) => n && log.info({ purged: n }, "trash purged"),
    (err) => {
      log.error({ err }, "trash purge failed");
      },
  );
void purge();
const purgeTimer = setInterval(purge, 3_600_000);

// Graceful shutdown (SIGTERM on redeploy): running jobs finish,
// no new job is taken, then the process exits.
let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "stopping workers");
  board.close();
  clearInterval(purgeTimer);
  ping.stop();
  await Promise.allSettled([...workers.map((w) => w.close()), sweeper.close()]);
  await telemetry?.shutdown();
  process.exit(0);
};
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
