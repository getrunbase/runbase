// Step execution: runs the block of a path step (timeouts, retries,
// budget gate, concurrency key) and starts the runs worker.
import { eq, sql } from "drizzle-orm";
import { Worker, type Job } from "bullmq";
import { decryptAll, redact } from "../secrets";
import {
  getBlock,
  blockContext,
  CostCapExceeded,
  StopError,
  type BlockEngine,
  type BlockResult,
} from "../blocks";
import { queueOptions } from "../bus";
import { fairProcessor } from "../queues/fair";
import { runSteps, workflowRuns } from "../db/schema";
import { AppError, appError } from "../errors/app-error";
import { formatIssues } from "../errors/clean";
import { isNonRetryable } from "./retryable";
import { recordError } from "../errors/record";
import { builtins, stepInput } from "./templates";
import { withTenant, type TenantContext } from "../tenant";
import { workflowsService } from "../workflows";
import { normalizeGraph } from "../workflows/graph";
import { stepOptions } from "../workflows/step-options";
import { parseDuration } from "../blocks/duration";
import {
  FINISHED,
  type StepJob,
  type Step,
  type Paths,
  parseJob,
  RUNS_QUEUE,
  MAX_STEPS,
  workerConcurrency,
  CONCURRENCY_POLL_MS,
  stepsScope,
} from "./state";
import { stage, dispatch, enqueue, clearOutbox } from "./outbox";
import { blockEngine } from "../blocks/engine";
import { runsService } from "./service";
import { aiGate, AI_LIMIT_MESSAGE } from "./budget";
import { quotaOf } from "../entitlements";
import {
  cancelRuns,
  resumeWaiting,
  olderOnKey,
  resumeIfChildDone,
  runDefinition,
  onPath,
  advance,
  failPath,
} from "./lifecycle";

// Rejects after `ms` (step timeout), even if the block ignores the signal.
const withTimeout = <T>(p: Promise<T>, signal: AbortSignal, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () =>
        reject(
          appError("runs.timedOut", "Timed out ({seconds} s)", {
            seconds: ms / 1000,
          }),
        ),
      ),
    ),
  ]);

// Persisted progress of a step (loop), key `<path>:<rank>`.
const checkpoint = (ctx: TenantContext, runId: string, key: string) => ({
  load: async () => {
    const [row] = await withTenant(ctx, (tx) =>
      tx
        .select({ v: sql<unknown>`${workflowRuns.checkpoints} -> ${key}` })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, runId)),
    );
    return row?.v ?? undefined;
  },
  save: async (state: unknown) => {
    await withTenant(ctx, (tx) =>
      tx
        .update(workflowRuns)
        .set({
          checkpoints: sql`${workflowRuns.checkpoints} || jsonb_build_object(${key}::text, ${JSON.stringify(state)}::jsonb)`,
        })
        .where(eq(workflowRuns.id, runId)),
    );
  },
});

// Runs the current step of a path. Idempotent: a job replayed after a
// crash ("stalled" job picked up by BullMQ) does not re-execute an already
// persisted step, and restarts the paths that follow from it. Run canceled, paused or
// workflow disabled: the step is not executed.
// Processes a job then deletes its outbox row. An exception
// (DB, Redis outage) leaves it: BullMQ replays the job; after final failure,
// the sweeper purges the row.
export async function processStep(job: Job<StepJob>) {
  await runStep(job);
  await clearOutbox(job.data.ob);
}

async function runStep(job: Job<StepJob>) {
  const { runId, path, n, attempt, ctx: jobCtx } = parseJob(job.data);
  let ctx = jobCtx;
  const ref = { runId, path, n };
  if (job.name === "expire")
    return void (await resumeWaiting(
      ctx,
      runId,
      (id, p) => id === path && p.n === n,
      "expired",
      { expired: true },
    ));
  const [run] = await withTenant(ctx, (tx) =>
    tx.select().from(workflowRuns).where(eq(workflowRuns.id, runId)),
  );
  if (!run || FINISHED.includes(run.status) || run.status === "paused") return;
  // Test run: writes and descendant runs flagged as test (A4).
  if (run.isTest) ctx = { ...ctx, test: true };
  const paths = run.paths as Paths;
  const p = paths[path];
  if (!p || p.n !== n || p.status !== "running") {
    // Path already advanced (crash before enqueueing the next ones): jobs of the
    // active paths that follow from it (same jobId: no duplicate in the queue).
    if (!p || p.n > n || p.status === "done")
      for (const [id, q] of Object.entries(paths))
        if (
          q.status === "running" &&
          (id === path || id.startsWith(`${path}.`))
        )
          await enqueue(ctx, { runId, path: id, n: q.n });
    return;
  }
  // Concurrency key (A8): a run not yet started waits for the older runs
  // on the same key to finish.
  const turnKey = (run.input as { concurrencyKey?: string } | null)
    ?.concurrencyKey;
  if (turnKey && run.stepCount === 0 && (await olderOnKey(ctx, run, turnKey))) {
    await enqueue(ctx, ref, {
      delay: CONCURRENCY_POLL_MS,
      retry: true,
      ...(attempt && { attempt }),
    });
    return;
  }
  const wf = await workflowsService.get(ctx, run.workflowId);
  if (wf?.status === "paused") {
    await cancelRuns(ctx, [eq(workflowRuns.id, runId)], "Workflow deactivated");
    return;
  }
  const { definition } = await runDefinition(ctx, run);
  // Global run timeout (`timeout` of the definition).
  if (
    definition.timeout &&
    Date.now() - run.createdAt.getTime() > parseDuration(definition.timeout)
  ) {
    await failPath(
      ctx,
      ref,
      p.step,
      null,
      `Run timeout exceeded (${definition.timeout})`,
    );
    return;
  }
  // Step limit reached by all the paths together.
  if (run.stepCount >= MAX_STEPS) {
    await onPath(ctx, ref, async (_tx, r, q, all) => {
      all[path] = { ...q, status: "failed" };
      return {
        set: { error: r.error ?? `Limit of ${MAX_STEPS} steps reached` },
        out: null,
      };
    });
    return;
  }
  const step = (definition.steps as Step[]).find((s) => s.id === p.step);
  const done = await withTenant(ctx, (tx) =>
    tx
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId))
      .orderBy(runSteps.seq),
  );
  const scope = {
    ...(run.input as object),
    ...builtins({ runId, workflowId: run.workflowId, test: run.isTest }),
    steps: stepsScope(done, path),
  };
  const block = step && (await getBlock(ctx, step.type));
  const raw = new Set(block?.raw);
  const input = step ? await stepInput(ctx, step.input, raw, scope) : null;
  // Workspace AI budget reached:
  // AI blocks do not run, the path goes into budget pause.
  if (step?.type.startsWith("ai.")) {
    const { blocked } = await withTenant(ctx, (tx) => aiGate(tx, ctx));
    if (blocked) {
      await onPath(ctx, ref, async (_tx, r, q, all) => {
        all[path] = { ...q, status: "paused_budget" };
        return { set: { error: r.error ?? AI_LIMIT_MESSAGE }, out: null };
      });
      return;
    }
  }
  // Execution time cap of the run (quota:maxRunDurationMs, waits excluded):
  // exhausted = path failed, otherwise the step timeout gets the remainder.
  const maxRunMs = await quotaOf(ctx.organizationId, "quota:maxRunDurationMs");
  const leftMs = maxRunMs - run.activeMs;
  if (leftMs <= 0) {
    await failPath(ctx, ref, p.step, input, runDurationExceeded(maxRunMs));
    return;
  }
  const opts = stepOptions(step);
  const capped = leftMs < opts.timeoutMs;
  if (capped) opts.timeoutMs = leftMs;
  const startedAt = new Date();
  const key = `${runId}:${path}:${n}`;
  // Step AbortController: at the timeout, the signal cancels the block's
  // ongoing work (http request, AI call, sandbox function killed).
  const controller = new AbortController();
  const signal = controller.signal;
  const timer = setTimeout(
    () =>
      controller.abort(
        capped
          ? appError(
              "runs.maxDurationExceeded",
              "Maximum run duration reached ({seconds} s)",
              {
              seconds: maxRunMs / 1000,
            })
          : appError("runs.timedOut", "Timed out ({seconds} s)", {
              seconds: opts.timeoutMs / 1000,
            }),
      ),
    opts.timeoutMs,
  );
  let result: BlockResult;
  try {
    // eslint-disable-next-line no-restricted-syntax -- internal invariant
    if (!step || !block) throw new Error(`Unknown step or block: ${p.step}`);
    result = await withTimeout(
      block.run(
        block.inputSchema.parse(input),
        blockContext(ctx, (run.input as { depth?: number }).depth ?? 0, {
          signal,
          key,
          checkpoint: checkpoint(ctx, runId, `${path}:${n}`),
          scope,
          run: { ...ref, stepId: step.id },
          engine: blockEngine(ctx, startSubWorkflow(ctx)),
        }),
      ),
      signal,
      opts.timeoutMs,
    );
    clearTimeout(timer);
    await addActiveMs(ctx, runId, startedAt);
  } catch (e) {
    clearTimeout(timer);
    await addActiveMs(ctx, runId, startedAt);
    const cap = e instanceof CostCapExceeded ? e : undefined;
    // Step retry according to its policy: new delayed job (exponential
    // backoff), the path stays at the same rank. Configuration and
    // authorization errors are not retried: a new attempt would fail the same.
    if (
      !cap &&
      !(e instanceof StopError) &&
      !isNonRetryable(e) &&
      attempt + 1 < opts.attempts
    ) {
      await enqueue(ctx, ref, {
        delay: opts.backoffMs * 2 ** attempt,
        retry: true,
        attempt: attempt + 1,
      });
      return;
    }
    // Secret masking in run logs.
    const values = await decryptAll(ctx);
    // Zod issues as `field: message` lines rather than a JSON dump.
    const error = redact(formatIssues((e as Error).message), values);
    const attempts = attempt + 1;
    // Error center: step failed after retries, cost cap
    // exceeded, invalid AI branch.
    const message = cap ? `Cost cap exceeded: ${error}` : error;
    if (opts.continueOnFail && step && block) {
      const next = normalizeGraph(definition).next[step.id];
      const branch = next?.error?.length
        ? "error"
        : (block.branches[0] ?? "ok");
      await recordError(ctx, {
        source: "workflow",
        runId,
        stepId: p.step,
        message: `${message} (the run continues)`,
        payload: { input },
      });
      await advance(
        ctx,
        ref,
        definition,
        step.id,
        input,
        { branch, output: { error }, cost: cap?.cost, tokens: cap?.tokens },
        {
          durationMs: Date.now() - startedAt.getTime(),
          startedAt,
          attempts,
          error,
        },
      );
      return;
    }
    await failPath(ctx, ref, p.step, input, message, {
      startedAt,
      attempts,
      cost: cap?.cost,
      tokens: cap?.tokens,
      // An AppError is an expected, explained failure: no stack stored.
      stack:
        e instanceof AppError
          ? undefined
          : redact((e as Error).stack ?? "", values),
    });
    return;
  }
  if (result.pause) {
    // Waiting for a decision: nothing is enqueued, `decide` will restart
    // (or the expiry). The other paths continue.
    // Expiry due date registered with the wait (survives Redis).
    const expire = await onPath(ctx, ref, async (tx, _r, q, all) => {
      all[path] = { ...q, status: "waiting" };
      return {
        out: result.expireMs
          ? [
              await stage(tx, ctx, ref, {
                delay: result.expireMs,
                expire: true,
              }),
            ]
          : [],
      };
    });
    await dispatch(expire);
    const child = (result.output as { runId?: unknown } | null)?.runId;
    if (step.type === "workflow.run" && typeof child === "string")
      await resumeIfChildDone(ctx, child);
    return;
  }
  await advance(ctx, ref, definition, step.id, input, result, {
    durationMs: Date.now() - startedAt.getTime(),
    startedAt,
    attempts: attempt + 1,
  });
}

// Run execution time cap reached (English template of runs.maxDurationExceeded).
const runDurationExceeded = (maxMs: number) =>
  `Maximum run duration reached (${maxMs / 1000} s)`;

// Adds the duration of a step attempt to the run execution time.
const addActiveMs = (ctx: TenantContext, runId: string, startedAt: Date) =>
  withTenant(ctx, (tx) =>
    tx
      .update(workflowRuns)
      .set({
        activeMs: sql`${workflowRuns.activeMs} + ${Date.now() - startedAt.getTime()}`,
      })
      .where(eq(workflowRuns.id, runId)),
  );

export const startRunsWorker = () =>
  // Concurrency capped per workspace.
  new Worker<StepJob>(RUNS_QUEUE, fairProcessor(processStep), {
    ...queueOptions(),
    concurrency: workerConcurrency(),
  });

// workflow.run: starts a workflow of the workspace by id or name.
const startSubWorkflow =
  (ctx: TenantContext): BlockEngine["startWorkflow"] =>
  async (workflow, opts) => {
    const wf = (await workflowsService.list(ctx)).find(
      (w) => w.id === workflow || w.name === workflow,
    );
    if (!wf) return null;
    return (await runsService.start(ctx, wf.id, opts)) ?? null;
  };
