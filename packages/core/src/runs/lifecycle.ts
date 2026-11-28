// Path transitions: advance, failure, waits, joins, cancellation and
// end-of-run notifications (parent sub-workflow, run.failed).
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { decryptAll, redact } from "../secrets";
import { type BlockResult } from "../blocks";
import { publish } from "../bus";
import { runSteps, workflowRuns } from "../db/schema";
import { recordError, resolveRunErrors } from "../errors/record";
import { renderInputs } from "./templates";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import { workflowsService, type Definition } from "../workflows";
import { normalizeGraph } from "../workflows/graph";
import {
  FINISHED,
  ACTIVE,
  type RunCtx,
  type Step,
  type PathState,
  type Paths,
  type PathRef,
  type RunRow,
  runCtx,
  runState,
  MAX_STEPS,
  ACTIVE_RUN_STATUSES,
  type ParentRef,
  releaseJoins,
} from "./state";
import { type Staged, stage, dispatch } from "./outbox";
import { addSpend } from "./budget";

// Cancels the unfinished runs of the workspace matching `where`: active
// paths canceled, run finished (frees the record's active index).
export async function cancelRuns(
  ctx: TenantContext,
  where: (SQL | undefined)[],
  reason?: string,
) {
  await requireScope(ctx, "write");
  const runs = await withTenant(ctx, async (tx) => {
    const runs = await tx
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workspaceId, ctx.workspaceId),
          inArray(workflowRuns.status, [...ACTIVE_RUN_STATUSES]),
          ...where,
        ),
      )
      .for("update");
    for (const run of runs) {
      await tx
        .update(workflowRuns)
        .set({
          paths: cancelPaths(run.paths as Paths),
          status: "canceled",
          currentStep: null,
          finishedAt: new Date(),
          ...(reason && { error: run.error ?? reason }),
        })
        .where(eq(workflowRuns.id, run.id));
      await audit(
        tx,
        ctx,
        "run.cancel",
        { type: "run", id: run.id },
        {
          ...(reason && { reason }),
        },
      );
    }
    return runs;
  });
  for (const run of runs) await afterFinish(run, "canceled");
  return runs.length;
}

const cancelPaths = (paths: Paths) =>
  Object.fromEntries(
    Object.entries(paths).map(([id, p]) => [
      id,
      ACTIVE.includes(p.status) || p.status === "joined"
        ? { ...p, status: "canceled" as const }
        : p,
    ]),
  );

// Restarts a waiting path (decide, expiry, end of a sub-workflow)
// on `branch`. Without a follow-up for `expired` or `error`, the path fails.
// false if nothing is waiting.
export async function resumeWaiting(
  ctx: TenantContext,
  runId: string,
  match: (path: string, p: PathState) => boolean,
  branch: string,
  output: unknown | ((p: PathState) => unknown),
) {
  const found = await withTenant(ctx, async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.id, runId),
          eq(workflowRuns.workspaceId, ctx.workspaceId),
        ),
      )
      .for("update");
    if (!run || FINISHED.includes(run.status)) return null;
    const paths = { ...(run.paths as Paths) };
    const entry = Object.entries(paths).find(
      ([id, p]) => p.status === "waiting" && match(id, p),
    );
    if (!entry) return null;
    const [id, p] = entry;
    const { definition } = await runDefinition(ctx, run);
    const dead =
      (branch === "expired" || branch === "error") &&
      !normalizeGraph(definition).next[p.step]?.[branch]?.length;
    const message =
      branch === "expired"
        ? `Approval expired without a decision (no "expired" branch)`
        : `Sub-workflow failed (no "error" branch)`;
    let error = run.error;
    if (dead) {
      paths[id] = { ...p, status: "failed" };
      error ??= `${p.step} : ${message}`;
    } else {
      const rest = { ...p, status: "running" as const };
      delete rest.message;
      paths[id] = rest;
    }
    const released: Staged[] = [];
    for (const job of dead ? releaseJoins(runId, paths) : [])
      released.push(await stage(tx, runCtx(run), job));
    const state = runState(paths, run.status);
    await tx
      .update(workflowRuns)
      .set({ paths, error, ...state })
      .where(eq(workflowRuns.id, runId));
    return { run, path: id, p, definition, dead, released, message, state };
  });
  if (!found) return false;
  const rctx = runCtx(found.run);
  if (found.dead) {
    await dispatch(found.released);
    await recordError(rctx, {
      source: "workflow",
      runId,
      stepId: found.p.step,
      message: found.message,
    });
    if (FINISHED.includes(found.state.status))
      await afterFinish(found.run, found.state.status);
    return { path: found.path, status: found.state.status };
  }
  await advance(
    rctx,
    { runId, path: found.path, n: found.p.n },
    found.definition,
    found.p.step,
    // Rendered input of the waiting step (human.approve message) kept on the
    // persisted step, so runs.get shows what was approved.
    found.p.message !== undefined ? { message: found.p.message } : null,
    { branch, output: typeof output === "function" ? output(found.p) : output },
    { durationMs: 0 },
  );
  return { path: found.path, status: found.state.status };
}

// Rendered concurrency key (A8): non-empty string, otherwise undefined.
export async function renderKey(
  ctx: TenantContext,
  template: string | undefined,
  scope: Record<string, unknown>,
) {
  if (!template) return undefined;
  const v = await renderInputs(ctx, template, scope);
  return v === undefined || v === null || v === "" ? undefined : String(v);
}

// An older run of the same workflow, active on the same concurrency key,
// goes first (A8).
export async function olderOnKey(ctx: TenantContext, run: RunRow, key: string) {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workflowId, run.workflowId),
          inArray(workflowRuns.status, [...ACTIVE_RUN_STATUSES]),
          sql`${workflowRuns.input} ->> 'concurrencyKey' = ${key}`,
          sql`(${workflowRuns.createdAt}, ${workflowRuns.id}) < (${run.createdAt.toISOString()}::timestamptz, ${run.id}::uuid)`,
        ),
      )
      .limit(1),
  );
  return !!row;
}

// Finished run: a failure publishes `run.failed` (trigger.run_failed); an
// awaited sub-workflow resumes its parent's path.
export async function afterFinish(run: RunRow, status: string) {
  const ctx = runCtx(run);
  const input = (run.input ?? {}) as { depth?: number; parent?: ParentRef };
  if (status === "failed")
    await publish("run.failed", {
      ...ctx,
      id: run.id,
      depth: (input.depth ?? 0) + 1,
    });
  // A replayed run that completes closes its errors (errors.retry is honest).
  if (status === "succeeded") await resolveRunErrors(ctx, run.id);
  if (input.parent) await notifyParent(run, status);
}

// Resumes the parent of a finished sub-workflow: branch ok (succeeded) or
// error, output = last output of the sub-workflow.
async function notifyParent(run: RunRow, status: string) {
  const parent = (run.input as { parent?: ParentRef }).parent!;
  const ctx = runCtx(run);
  const [last] = await withTenant(ctx, (tx) =>
    tx
      .select({ output: runSteps.output })
      .from(runSteps)
      .where(and(eq(runSteps.runId, run.id), sql`${runSteps.error} is null`))
      .orderBy(desc(runSteps.seq))
      .limit(1),
  );
  await resumeWaiting(
    ctx,
    parent.runId,
    (id, p) => id === parent.path && p.n === parent.n,
    status === "succeeded" ? "ok" : "error",
    {
      runId: run.id,
      status,
      output: last?.output ?? null,
      ...(run.error && { error: run.error }),
    },
  );
}

// The sub-workflow may have finished before the parent started waiting: immediate
// resume (resumeWaiting is idempotent, only one resume goes through).
export async function resumeIfChildDone(
  ctx: TenantContext,
  childRunId: string,
) {
  const [child] = await withTenant(ctx, (tx) =>
    tx.select().from(workflowRuns).where(eq(workflowRuns.id, childRunId)),
  );
  if (child && FINISHED.includes(child.status))
    await notifyParent(child, child.status);
}

export const runDefinition = async (
  ctx: TenantContext,
  run: typeof workflowRuns.$inferSelect,
) =>
  (await workflowsService.versions(ctx, run.workflowId)).find(
    (v) => v.version === run.version,
  )! as { definition: Definition };

// Locks the run and applies `fn` to the path if it is still at rank `n`
// and running (otherwise: replayed job, nothing to do). `fn` returns the new state
// of the paths and the run fields to change.
export async function onPath<T>(
  ctx: RunCtx,
  { runId, path, n }: PathRef,
  fn: (
    tx: Tx,
    run: typeof workflowRuns.$inferSelect,
    p: PathState,
    paths: Paths,
  ) => Promise<{ set?: Partial<typeof workflowRuns.$inferInsert>; out: T }>,
): Promise<T | undefined> {
  const released: Staged[] = [];
  let finished: { run: RunRow; status: string } | undefined;
  const res = await withTenant(ctx, async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .for("update");
    const paths = { ...((run?.paths ?? {}) as Paths) };
    const p = paths[path];
    if (!run || run.status === "canceled") return undefined;
    if (!p || p.n !== n || p.status !== "running") return undefined;
    const { set, out } = await fn(tx, run, p, paths);
    for (const job of releaseJoins(runId, paths))
      released.push(await stage(tx, ctx, job));
    const state = runState(paths, run.status);
    await tx
      .update(workflowRuns)
      .set({ ...set, paths, ...state })
      .where(eq(workflowRuns.id, runId));
    if (FINISHED.includes(state.status))
      finished = {
        run: { ...run, error: set?.error ?? run.error },
        status: state.status,
      };
    return out;
  });
  await dispatch(released);
  if (finished) await afterFinish(finished.run, finished.status);
  return res;
}

// Persists the path step and advances it to `next[stepId][branch]`: one
// target extends the path, several split it into child paths.
export async function advance(
  ctx: TenantContext,
  ref: PathRef,
  definition: Definition,
  stepId: string,
  input: unknown,
  result: BlockResult,
  meta: {
    durationMs: number;
    startedAt?: Date;
    attempts?: number;
    error?: string;
  },
) {
  const { runId, path, n } = ref;
  const targets =
    normalizeGraph(definition).next[stepId]?.[result.branch] ?? [];
  // Secret masking in run logs.
  const output = JSON.parse(
    redact(JSON.stringify(result.output ?? null), await decryptAll(ctx)),
  );
  const isJoin = (id: string) =>
    (definition.steps as Step[]).some((s) => s.id === id && s.join);
  const jobs = await onPath(ctx, ref, async (tx, run, p, paths) => {
    const seq = run.stepCount;
    const stepCount = seq + 1;
    await tx.insert(runSteps).values({
      organizationId: ctx.organizationId,
      runId,
      seq,
      path,
      stepId,
      input,
      output,
      branch: result.branch,
      cost: result.cost,
      tokens: result.tokens,
      ...meta,
    });
    if (result.cost) await addSpend(tx, ctx, result.cost);
    // Next steps registered in the outbox with their delay (wait): the
    // transaction that advances the path also carries its due date.
    const jobs: PathRef[] = [];
    let error = run.error;
    if (!targets.length) paths[path] = { ...p, status: "done" };
    // Limit counted over all paths of the run.
    else if (stepCount >= MAX_STEPS) {
      paths[path] = { step: targets[0]!, n: n + 1, status: "failed" };
      error ??= `Limit of ${MAX_STEPS} steps reached`;
    } else if (targets.length === 1) {
      const step = targets[0]!;
      const status = isJoin(step) ? "joined" : "running";
      paths[path] = { step, n: n + 1, status };
      if (status === "running") jobs.push({ runId, path, n: n + 1 });
    } else {
      paths[path] = { ...p, status: "done" };
      targets.forEach((step, i) => {
        const status = isJoin(step) ? "joined" : "running";
        paths[`${path}.${i}`] = { step, n: 0, status };
        if (status === "running")
          jobs.push({ runId, path: `${path}.${i}`, n: 0 });
      });
    }
    const staged: Staged[] = [];
    for (const job of jobs)
      staged.push(await stage(tx, ctx, job, { delay: result.delayMs }));
    return { set: { stepCount, error }, out: staged };
  });
  await dispatch(jobs);
}

// Path failure: failed step persisted, path failed (the run will be
// once the other paths are done), error visible in the center.
export async function failPath(
  ctx: TenantContext,
  ref: PathRef,
  stepId: string,
  input: unknown,
  error: string,
  extra: {
    startedAt?: Date;
    attempts?: number;
    cost?: number;
    tokens?: { input: number; output: number };
    stack?: string;
  } = {},
) {
  const { runId, path } = ref;
  const { stack, ...row } = extra;
  await onPath(ctx, ref, async (tx, r, q, all) => {
    const seq = r.stepCount;
    await tx.insert(runSteps).values({
      organizationId: ctx.organizationId,
      runId,
      seq,
      path,
      stepId,
      input,
      error,
      durationMs: row.startedAt ? Date.now() - row.startedAt.getTime() : 0,
      ...row,
    });
    if (row.cost) await addSpend(tx, ctx, row.cost);
    all[path] = { ...q, status: "failed", failedSeq: seq };
    return { set: { stepCount: seq + 1, error: r.error ?? error }, out: null };
  });
  await recordError(ctx, {
    source: "workflow",
    runId,
    stepId,
    message: error,
    payload: { input },
    stack,
  });
}
