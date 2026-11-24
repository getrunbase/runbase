// Write side of the runs service: start, control (cancel, pause, resume,
// retry) and AI budget settings.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { runSteps, workflowRuns, workspaces } from "../db/schema";
import { recordsService } from "../records";
import { exceedsLimit, rateLimit } from "../quotas";
import { quotaOf } from "../entitlements";
import { withTenant, type TenantContext } from "../tenant";
import { workflowsService, type Definition } from "../workflows";
import { normalizeGraph } from "../workflows/graph";
import { appError } from "../errors/app-error";
import { assertUuid } from "../lib/uuid";
import { track } from "../extensions";
import {
  FINISHED,
  type Paths,
  runCtx,
  runState,
  uniqueViolation,
  ACTIVE_RUN_STATUSES,
  type ParentRef,
  RunAlreadyActive,
} from "./state";
import { type Staged, stage, dispatch } from "./outbox";
import { readBudget, resumeBudgetRuns, unpauseBudget } from "./budget";
import { cancelRuns, resumeWaiting, renderKey } from "./lifecycle";
import { runQueries } from "./queries";

export const runsService = {
  start: async (
    ctx: TenantContext,
    workflowId: string,
    // `event`: payload of the triggering event ({{event.<path>}}).
    // `idempotencyKey`: a 2nd start with the same key returns the existing run.
    // `version` + `input`: identical replay of a run.
    opts: {
      recordId?: string;
      depth?: number;
      event?: unknown;
      idempotencyKey?: string;
      version?: number;
      input?: unknown;
      // Awaited sub-workflow (workflow.run): path of the parent run to resume.
      parent?: ParentRef;
      // Test run: deleted by workspace.purge_test.
      test?: boolean;
      // Manual start (workflows.run_manual): prioritized in the queue.
      manual?: boolean;
    } = {},
  ) => {
    await requireScope(ctx, "write");
    await rateLimit(ctx, "runs");
    const wf = await workflowsService.get(ctx, workflowId);
    if (!wf) return null;
    const version = opts.version ?? wf.currentVersion;
    const definition =
      version === wf.currentVersion
        ? wf.definition
        : (await workflowsService.versions(ctx, workflowId)).find(
            (v) => v.version === version,
          )?.definition;
    if (!definition) return null;
    const { entry } = normalizeGraph(definition as Definition);
    const paths: Paths = Object.fromEntries(
      entry.map((step, i) => [`${i}`, { step, n: 0, status: "running" }]),
    );
    const record =
      opts.input === undefined && opts.recordId
        ? await recordsService.get(ctx, opts.recordId)
        : null;
    const concurrencyKey =
      opts.input === undefined
        ? await renderKey(ctx, (definition as Definition).concurrencyKey, {
            record,
            event: opts.event,
          })
        : undefined;
    const run = await withTenant(ctx, async (tx) => {
      const [row] = await tx
        .insert(workflowRuns)
        .values({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          workflowId,
          version,
          recordId: opts.recordId ?? null,
          actor: ctx.actor,
          input: opts.input ?? {
            record,
            depth: opts.depth ?? 0,
            ...(opts.event !== undefined && { event: opts.event }),
            ...(opts.parent && { parent: opts.parent }),
            ...(concurrencyKey && { concurrencyKey }),
            ...(opts.manual && { manual: true }),
          },
          currentStep: entry[0] ?? null,
          paths,
          status: entry.length ? "running" : "succeeded",
          finishedAt: entry.length ? null : new Date(),
          idempotencyKey: opts.idempotencyKey ?? null,
          isTest: opts.test ?? ctx.test ?? false,
        })
        .returning();
      // First jobs registered in the same transaction as the run.
      const staged: Staged[] = [];
      for (const path of Object.keys(paths))
        staged.push(
          await stage(tx, runCtx(row!), { runId: row!.id, path, n: 0 }),
        );
      return { row: row!, created: true, staged };
    }).catch((e) => {
      const unique = uniqueViolation(e);
      if (!unique) throw e;
      // With a key, Postgres may report the active index before the
      // idempotency one (index creation order): check the key first.
      if (unique !== "workflow_runs_idempotency_idx" && !opts.idempotencyKey)
        throw new RunAlreadyActive();
      return { row: null, created: false, staged: [] };
    });
    if (!run.created) {
      // Already triggered (bus replay): existing run, nothing more.
      const [existing] = await withTenant(ctx, (tx) =>
        tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.workflowId, workflowId),
              eq(workflowRuns.idempotencyKey, opts.idempotencyKey!),
            ),
          ),
      );
      if (!existing) throw new RunAlreadyActive();
      return existing;
    }
    await dispatch(run.staged);
    // Product analytics (no-op without extension): identifiers only.
    void track("run.started", {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      workflowId,
      runId: run.row!.id,
      test: run.row!.isTest,
    });
    return run.row!;
  },
  ...runQueries,
  // Cancels an unfinished run: its paths stop, the record is freed
  // for a new run. false if the run is already finished.
  cancel: async (ctx: TenantContext, runId: string) => {
    assertUuid(runId);
    return (await cancelRuns(ctx, [eq(workflowRuns.id, runId)])) > 0;
  },
  // Bulk-cancels the unfinished runs of a workflow and/or a status.
  // Returns the number of canceled runs.
  cancelBulk: async (
    ctx: TenantContext,
    filter: {
      workflowId?: string;
      status?: (typeof ACTIVE_RUN_STATUSES)[number];
    },
  ) => {
    if (!filter.workflowId && !filter.status)
      throw appError(
        "runs.filterRequired",
        "Filter required: workflowId or status",
      );
    if (filter.workflowId) assertUuid(filter.workflowId);
    return cancelRuns(ctx, [
      filter.workflowId
        ? eq(workflowRuns.workflowId, filter.workflowId)
        : undefined,
      filter.status ? eq(workflowRuns.status, filter.status) : undefined,
    ]);
  },
  // Manual pause: running steps finish, the next ones wait for
  // runs.resume. false if the run is not running.
  pause: async (ctx: TenantContext, runId: string) => {
    await requireScope(ctx, "write");
    return withTenant(ctx, async (tx) => {
      const rows = await tx
        .update(workflowRuns)
        .set({ status: "paused" })
        .where(
          and(
            eq(workflowRuns.id, runId),
            eq(workflowRuns.workspaceId, ctx.workspaceId),
            inArray(workflowRuns.status, [
              "running",
              "waiting",
              "paused_budget",
            ]),
          ),
        )
        .returning({ id: workflowRuns.id });
      if (rows.length)
        await audit(tx, ctx, "run.pause", { type: "run", id: runId });
      return rows.length > 0;
    });
  },
  // Resumes a manually paused run: its running paths restart.
  resume: async (ctx: TenantContext, runId: string) => {
    await requireScope(ctx, "write");
    const run = await withTenant(ctx, async (tx) => {
      const [run] = await tx
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.id, runId),
            eq(workflowRuns.workspaceId, ctx.workspaceId),
            eq(workflowRuns.status, "paused"),
          ),
        )
        .for("update");
      if (!run) return null;
      await tx
        .update(workflowRuns)
        .set(runState(run.paths as Paths))
        .where(eq(workflowRuns.id, runId));
      await audit(tx, ctx, "run.resume", { type: "run", id: runId });
      const staged: Staged[] = [];
      for (const [path, p] of Object.entries(run.paths as Paths))
        if (p.status === "running")
          staged.push(
            await stage(
              tx,
              runCtx(run),
              { runId, path, n: p.n },
              { retry: true },
            ),
          );
      return staged;
    });
    if (!run) return false;
    await dispatch(run);
    return true;
  },
  // Restarts a finished run from a step: that step and the rest of its path
  // are cleared and re-executed, the steps before are kept.
  retryFrom: async (ctx: TenantContext, runId: string, stepId: string) => {
    await requireScope(ctx, "write");
    const res = await withTenant(ctx, async (tx) => {
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
      if (!run) return null;
      if (!FINISHED.includes(run.status))
        throw appError(
          "runs.notFinished",
          "The run is not finished: cancel it first",
        );
      const [from] = await tx
        .select()
        .from(runSteps)
        .where(and(eq(runSteps.runId, runId), eq(runSteps.stepId, stepId)))
        .orderBy(desc(runSteps.seq))
        .limit(1);
      if (!from)
        throw appError(
          "runs.stepNeverRan",
          "Step {step} never ran in this run",
          {
            step: stepId,
          },
        );
      const path = from.path;
      const below = (id: string) => id === path || id.startsWith(`${path}.`);
      await tx
        .delete(runSteps)
        .where(
          and(
            eq(runSteps.runId, runId),
            gte(runSteps.seq, from.seq),
            sql`(${runSteps.path} = ${path} or ${runSteps.path} like ${`${path}.%`})`,
          ),
        );
      const paths = Object.fromEntries(
        Object.entries(run.paths as Paths).filter(
          ([id]) => !below(id) || id === path,
        ),
      );
      const n = (paths[path]?.n ?? 0) + 1;
      paths[path] = { step: stepId, n, status: "running" };
      try {
        await tx
          .update(workflowRuns)
          .set({ paths, error: null, checkpoints: {}, ...runState(paths) })
          .where(eq(workflowRuns.id, runId));
      } catch (e) {
        if (uniqueViolation(e)) throw new RunAlreadyActive();
        throw e;
      }
      await audit(
        tx,
        ctx,
        "run.retry_from",
        { type: "run", id: runId },
        {
          stepId,
        },
      );
      return stage(tx, runCtx(run), { runId, path, n }, { retry: true });
    });
    if (!res) return false;
    await dispatch([res]);
    return true;
  },
  // Replays a run: new run of the same version, same record, same input.
  replay: async (ctx: TenantContext, runId: string) => {
    const run = await runsService.get(ctx, runId);
    if (!run) return null;
    return runsService.start(ctx, run.workflowId, {
      recordId: run.recordId ?? undefined,
      version: run.version,
      input: run.input,
    });
  },
  // Monthly AI budget: cap, month spending, exhausted or not.
  budget: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) => readBudget(tx, ctx.workspaceId));
  },
  // Sets the budget (null = unlimited); if it is no longer reached, the
  // workspace runs in `paused_budget` resume on their AI step.
  setBudget: async (ctx: TenantContext, budgetUsd: number | null) => {
    await requireScope(ctx, "admin");
    const { budget, resumed } = await withTenant(ctx, async (tx) => {
      // Never beyond entitlements.
      const max = await quotaOf(ctx.organizationId, "quota:aiBudgetUsd");
      if (budgetUsd != null && budgetUsd > max)
        throw exceedsLimit("aiBudgetUsd", budgetUsd, max);
      await tx
        .update(workspaces)
        .set({ aiBudgetUsd: budgetUsd })
        .where(eq(workspaces.id, ctx.workspaceId));
      await audit(
        tx,
        ctx,
        "workspace.ai_budget",
        { type: "workspace", id: ctx.workspaceId },
        { budgetUsd },
      );
      const budget = await readBudget(tx, ctx.workspaceId);
      const resumed = await unpauseBudget(tx, ctx);
      return { budget, resumed };
    });
    await dispatch(resumed);
    return { ...budget, resumed: resumed.length };
  },
  // Resumes runs paused on budget if AI is allowed again (budget
  // raised, own key added). Returns the number of restarted paths.
  resumeBudget: async (ctx: TenantContext) => {
    await requireScope(ctx, "write");
    return resumeBudgetRuns(ctx);
  },
  // Decision on a paused run: persists the human.approve step with the
  // approved / rejected branch and restarts the run. false if not waiting.
  // Several waiting paths: `path` chooses which one (default: the first).
  decide: async (
    ctx: TenantContext,
    runId: string,
    approved: boolean,
    path?: string,
  ) => {
    await requireScope(ctx, "write");
    return resumeWaiting(
      ctx,
      runId,
      (id) => !path || id === path,
      approved ? "approved" : "rejected",
      { approved, by: ctx.actor },
    );
  },
};

// Replays a failed run (error center): the failed step of
// each failed path is cleared and re-executed. false if the run is not
// failed.
export async function retryRun(ctx: TenantContext, runId: string) {
  await requireScope(ctx, "write");
  const retried = await withTenant(ctx, async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.id, runId),
          eq(workflowRuns.workspaceId, ctx.workspaceId),
          eq(workflowRuns.status, "failed"),
        ),
      )
      .for("update");
    if (!run) return null;
    const paths = { ...(run.paths as Paths) };
    const failed = Object.entries(paths).filter(
      ([, p]) => p.status === "failed",
    );
    if (!failed.length) return null;
    for (const [path, { failedSeq, ...p }] of failed) {
      if (failedSeq !== undefined)
        await tx
          .delete(runSteps)
          .where(and(eq(runSteps.runId, runId), eq(runSteps.seq, failedSeq)));
      paths[path] = { ...p, status: "running" };
    }
    try {
      await tx
        .update(workflowRuns)
        .set({ paths, error: null, ...runState(paths) })
        .where(eq(workflowRuns.id, runId));
    } catch (e) {
      if (uniqueViolation(e)) throw new RunAlreadyActive();
      throw e;
    }
    const staged: Staged[] = [];
    for (const [path, p] of failed)
      staged.push(
        await stage(tx, runCtx(run), { runId, path, n: p.n }, { retry: true }),
      );
    return staged;
  });
  if (!retried) return false;
  await dispatch(retried);
  return true;
}
