// Job outbox: jobs are registered in the transaction that changes the run
// state, then pushed to Redis after commit; a sweeper replays lost ones.
import { asc, eq, lt } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import { db } from "../db/client";
import { queueOptions } from "../bus";
import { fairAdd } from "../queues/fair";
import { runOutbox, workflowRuns } from "../db/schema";
import { withTenant, type Tx } from "../tenant";
import {
  FINISHED,
  type StepJob,
  type RunCtx,
  type PathRef,
  runCtx,
  RUNS_QUEUE,
} from "./state";
import { logger } from "../logger";

// BullMQ attempts for infrastructure outages (DB, Redis); block
// failures follow the step retry policy (`retry`).
const ATTEMPTS = 3;

let queue: Queue<StepJob> | undefined;
export const runsQueue = () =>
  (queue ??= new Queue(RUNS_QUEUE, queueOptions()));

// `retry`: resume of an already attempted step (paused_budget, retry, resume),
// new job id. `expire`: delayed job that expires a human approval.
type EnqueueOpts = {
  delay?: number;
  retry?: boolean;
  attempt?: number;
  expire?: boolean;
};
// Job registered in the outbox, not yet pushed to Redis.
export type Staged = { id: string; ctx: RunCtx; ref: PathRef; o: EnqueueOpts };

// Stable job id: resuming a step carries the id of its outbox row,
// so the sweeper that replays it does not create a duplicate.
const jobIdOf = (ref: PathRef, o: EnqueueOpts, outboxId: string) =>
  `${ref.runId}-${ref.path}-${ref.n}${o.expire ? "-expire" : ""}${o.retry ? `-r${outboxId}` : ""}`;

// Fair rank per workspace: manual and test runs first.
const addJob = (ctx: RunCtx, ref: PathRef, o: EnqueueOpts, outboxId: string) =>
  fairAdd(
    runsQueue(),
    o.expire ? "expire" : "step",
    { ...ctx, ...ref, ...(o.attempt && { attempt: o.attempt }), ob: outboxId },
    {
      delay: o.delay,
      jobId: jobIdOf(ref, o, outboxId),
      attempts: ATTEMPTS,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
    !!(ctx.urgent || ctx.test),
  );

// Registers a job in the outbox, in the transaction that changes the run state:
// the state and the intent to execute are committed together. `wait_until`:
// job due date (delay, expiry).
export async function stage(
  tx: Tx,
  ctx: RunCtx,
  ref: PathRef,
  o: EnqueueOpts = {},
): Promise<Staged> {
  const [row] = await tx
    .insert(runOutbox)
    .values({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      runId: ref.runId,
      kind: o.expire ? "expire" : "step",
      path: ref.path,
      n: ref.n,
      attempt: o.attempt ?? 0,
      retry: !!o.retry,
      waitUntil: new Date(Date.now() + (o.delay ?? 0)),
    })
    .returning({ id: runOutbox.id });
  return { id: row!.id, ctx, ref, o };
}

// Pushes the registered jobs to Redis, after commit. A failure (Redis
// unavailable, crash) leaves the row: the sweeper will pick them up.
export async function dispatch(staged: Staged[] | undefined) {
  for (const s of staged ?? [])
    await addJob(s.ctx, s.ref, s.o, s.id).catch((e: unknown) =>
      logger.error({ err: e }, "runs: enqueue deferred to the outbox sweeper"),
    );
}

// Outside a state transaction (retries, waiting for a turn): outbox then Redis.
export async function enqueue(ctx: RunCtx, ref: PathRef, o: EnqueueOpts = {}) {
  await dispatch([await withTenant(ctx, (tx) => stage(tx, ctx, ref, o))]);
}

// Processed job: its outbox row is no longer needed (owner access,
// like the sweeper).
export const clearOutbox = async (id: string | undefined) => {
  if (id) await db.delete(runOutbox).where(eq(runOutbox.id, id));
};

// Grace period before a due row is considered lost: covers
// the normal gap between commit and enqueue, and a late job.
export const OUTBOX_GRACE_MS = 30_000;

// Sweeper: re-enqueues rows due for more than `graceMs`
// whose Redis job has disappeared (crash before the enqueue, Redis flushed). Rows
// of a finished run or of an already processed job are deleted. Returns the number of
// re-enqueued jobs.
export async function sweepRunOutbox({
  graceMs = OUTBOX_GRACE_MS,
  limit = 500,
} = {}) {
  const due = await db
    .select({ o: runOutbox, run: workflowRuns })
    .from(runOutbox)
    .innerJoin(workflowRuns, eq(workflowRuns.id, runOutbox.runId))
    .where(lt(runOutbox.waitUntil, new Date(Date.now() - graceMs)))
    .orderBy(asc(runOutbox.waitUntil))
    .limit(limit);
  let requeued = 0;
  for (const { o, run } of due) {
    const ref = { runId: o.runId, path: o.path, n: o.n };
    const opts = {
      retry: o.retry,
      attempt: o.attempt,
      expire: o.kind === "expire",
    };
    if (FINISHED.includes(run.status)) {
      await clearOutbox(o.id);
      continue;
    }
    const job = await runsQueue().getJob(jobIdOf(ref, opts, o.id));
    if (job) {
      const state = await job.getState();
      if (state === "completed" || state === "failed") await clearOutbox(o.id);
      continue;
    }
    await addJob(runCtx(run), ref, opts, o.id);
    requeued++;
  }
  return requeued;
}

// Periodic sweeper: BullMQ scheduler (a single pass at a time, whatever
// the number of workers).
export const RUNS_SWEEP_QUEUE = "workflow-runs-sweep";
export function startRunsSweeper(everyMs = 15_000) {
  const q = new Queue(RUNS_SWEEP_QUEUE, queueOptions());
  void q
    .upsertJobScheduler("run-outbox", { every: everyMs }, { name: "sweep" })
    .catch((e: unknown) =>
      logger.error({ err: e }, "runs: sweeper scheduler failed"),
    );
  const worker = new Worker(
    RUNS_SWEEP_QUEUE,
    async () => {
      const n = await sweepRunOutbox();
      if (n) logger.info({ jobs: n }, "runs: outbox sweeper re-enqueued jobs");
      return n;
    },
    { ...queueOptions(), concurrency: 1 },
  );
  return {
    close: async () => {
      await worker.close();
      await q.close();
    },
  };
}
