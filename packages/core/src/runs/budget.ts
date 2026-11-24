// Monthly AI budget of the workspace: gate, spending and budget pauses.
import { and, eq, inArray, sql } from "drizzle-orm";
import { audit } from "../audit";
import { workflowRuns, workspaces } from "../db/schema";
import { quotaOf } from "../entitlements";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import { recordAiCost } from "../telemetry";
import { type Paths, runCtx, runState } from "./state";
import { type Staged, stage, dispatch } from "./outbox";
import { appError } from "../errors/app-error";

// Monthly AI budget of the workspace.
const month = () => new Date().toISOString().slice(0, 7);
const ALERT_RATIO = 0.8;

export async function readBudget(tx: Tx, workspaceId: string) {
  const [w] = await tx
    .select({
      budgetUsd: workspaces.aiBudgetUsd,
      spentUsd: workspaces.aiSpentUsd,
      month: workspaces.aiSpentMonth,
      organizationId: workspaces.organizationId,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  const spentUsd = w?.month === month() ? w.spentUsd : 0;
  // Effective budget = min(preference, entitlement cap); without preference:
  // the cap (unlimited without a cap).
  const cap = w
    ? await quotaOf(w.organizationId, "quota:aiBudgetUsd")
    : Infinity;
  const budgetUsd = Number.isFinite(cap)
    ? Math.min(w?.budgetUsd ?? cap, cap)
    : (w?.budgetUsd ?? null);
  return {
    budgetUsd,
    spentUsd,
    exhausted: budgetUsd != null && spentUsd >= budgetUsd,
  };
}

// Workspace AI budget, set by the user on their own keys.
// The platform provides no AI: no platform cap.
export const AI_LIMIT_MESSAGE =
  "AI budget reached for this workspace. Raise it in Settings to continue: " +
  "paused runs will resume.";

export async function aiGate(tx: Tx, ctx: TenantContext) {
  const budget = await readBudget(tx, ctx.workspaceId);
  return { blocked: budget.exhausted };
}

// Paths paused on budget (including in a run whose other paths
// are still running), restarted if AI is allowed again.
// Returns the jobs registered in the outbox, to push after commit.
export async function unpauseBudget(tx: Tx, ctx: TenantContext) {
  const resumed: Staged[] = [];
  if (!(await aiGate(tx, ctx)).blocked) {
    const runs = await tx
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workspaceId, ctx.workspaceId),
          inArray(workflowRuns.status, [
            "running",
            "waiting",
            "paused_budget",
            "paused",
          ]),
        ),
      )
      .for("update");
    for (const run of runs) {
      const paths = { ...(run.paths as Paths) };
      const paused = Object.entries(paths).filter(
        ([, p]) => p.status === "paused_budget",
      );
      if (!paused.length) continue;
      for (const [path, p] of paused) {
        paths[path] = { ...p, status: "running" };
        resumed.push(
          await stage(
            tx,
            runCtx(run),
            { runId: run.id, path, n: p.n },
            { retry: true },
          ),
        );
      }
      await tx
        .update(workflowRuns)
        .set({ paths, ...runState(paths, run.status) })
        .where(eq(workflowRuns.id, run.id));
    }
  }
  return resumed;
}

// Real AI call outside a run (dry run `ai: true`, `live` step test): same
// rules as in a run. Refused if blocked, cost deducted afterwards.
export async function assertAiAllowed(ctx: TenantContext) {
  const { blocked } = await withTenant(ctx, (tx) => aiGate(tx, ctx));
  if (blocked) throw appError("ai.budgetReached", AI_LIMIT_MESSAGE);
}
export async function chargeAi(ctx: TenantContext, cost: number | undefined) {
  if (cost) await withTenant(ctx, (tx) => addSpend(tx, ctx, cost));
}

// Adds the cost of an AI step to the month counter; alert (audit) when
// crossing 80 % of the budget.
export async function addSpend(tx: Tx, ctx: TenantContext, cost: number) {
  recordAiCost(ctx.workspaceId, cost);
  const m = month();
  const [w] = await tx
    .update(workspaces)
    .set({
      aiSpentUsd: sql`case when ${workspaces.aiSpentMonth} = ${m} then ${workspaces.aiSpentUsd} else 0 end + ${cost}`,
      aiSpentMonth: m,
    })
    .where(eq(workspaces.id, ctx.workspaceId))
    .returning({
      budget: workspaces.aiBudgetUsd,
      spent: workspaces.aiSpentUsd,
    });
  if (!w?.budget) return;
  const limit = w.budget * ALERT_RATIO;
  if (w.spent >= limit && w.spent - cost < limit)
    await audit(
      tx,
      ctx,
      "workspace.ai_budget_alert",
      { type: "workspace", id: ctx.workspaceId },
      { budgetUsd: w.budget, spentUsd: w.spent },
    );
}

// Resumes runs paused on budget once AI is allowed again (budget raised, own
// key added). Returns the number of restarted paths. Callers check scopes.
export async function resumeBudgetRuns(ctx: TenantContext) {
  const resumed = await withTenant(ctx, (tx) => unpauseBudget(tx, ctx));
  await dispatch(resumed);
  return resumed.length;
}
