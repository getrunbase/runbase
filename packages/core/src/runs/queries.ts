// Read side of the runs service: run details, lists and KPI counts.
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { requireScope } from "../api-keys";
import { functionLogs, runSteps, workflowRuns, workflows } from "../db/schema";
import { withTenant, type TenantContext } from "../tenant";
import { isUuid } from "../lib/uuid";
import { type Paths, type RunFilter, RUN_STATUSES } from "./state";

export const runQueries = {
  get: async (ctx: TenantContext, runId: string) => {
    await requireScope(ctx, "read");
    // Non-uuid id: not found (null), no raw SQL error.
    if (!isUuid(runId)) return null;
    return withTenant(ctx, async (tx) => {
      const [run] = await tx
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.id, runId),
            eq(workflowRuns.workspaceId, ctx.workspaceId),
          ),
        );
      if (!run) return null;
      const steps = await tx
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, runId))
        .orderBy(runSteps.seq);
      // Logs of the functions (fn.*) executed by each step, attempts included.
      const logs = await tx
        .select()
        .from(functionLogs)
        .where(eq(functionLogs.runId, runId))
        .orderBy(functionLogs.createdAt);
      return {
        ...run,
        steps: steps.map((s) => {
          const own = logs.filter(
            (l) => l.stepId === s.stepId && l.path === s.path,
          );
          return own.length
            ? {
                ...s,
                logs: own.map((l) => ({
                  logs: l.logs,
                  error: l.error,
                  durationMs: l.durationMs,
                  at: l.createdAt,
                })),
              }
            : s;
        }),
      };
    });
  },
  // Runs of a record with their steps (record page), from newest to oldest.
  forRecord: async (ctx: TenantContext, recordId: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const runs = await tx
        .select({ run: workflowRuns, workflowName: workflows.name })
        .from(workflowRuns)
        .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
        .where(
          and(
            eq(workflowRuns.recordId, recordId),
            eq(workflowRuns.workspaceId, ctx.workspaceId),
          ),
        )
        .orderBy(desc(workflowRuns.createdAt));
      if (!runs.length) return [];
      const steps = await tx
        .select()
        .from(runSteps)
        .where(
          inArray(
            runSteps.runId,
            runs.map((r) => r.run.id),
          ),
        )
        .orderBy(runSteps.seq);
      return runs.map(({ run, workflowName }) => ({
        ...run,
        workflowName,
        steps: steps.filter((s) => s.runId === run.id),
      }));
    });
  },
  // List of runs filtered by status, workflow, record and dates,
  // from newest to oldest, paginated: `cursor` = received `nextCursor`.
  list: async (ctx: TenantContext, filter: RunFilter = {}) => {
    await requireScope(ctx, "read");
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return withTenant(ctx, async (tx) => {
      const found = await tx
        .select({ run: workflowRuns, workflowName: workflows.name })
        .from(workflowRuns)
        .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
        .where(
          and(
            eq(workflowRuns.workspaceId, ctx.workspaceId),
            ...runConditions(filter),
            filter.cursor && isUuid(filter.cursor)
              ? sql`(${workflowRuns.createdAt}, ${workflowRuns.id}) < (select created_at, id from workflow_runs where id = ${filter.cursor})`
              : undefined,
          ),
        )
        .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
        .limit(limit + 1);
      const rows = found.slice(0, limit);
      const nextCursor =
        found.length > limit ? rows[rows.length - 1]!.run.id : null;
      const hasMore = nextCursor !== null;
      if (!rows.length) return { items: [], hasMore, nextCursor };
      const costs = await tx
        .select({
          runId: runSteps.runId,
          cost: sql<number>`coalesce(sum(${runSteps.cost}), 0)`.mapWith(Number),
        })
        .from(runSteps)
        .where(
          inArray(
            runSteps.runId,
            rows.map((r) => r.run.id),
          ),
        )
        .groupBy(runSteps.runId);
      const items = rows.map(({ run, workflowName }) => ({
        ...run,
        workflowName,
        cost: costs.find((c) => c.runId === run.id)?.cost ?? 0,
      }));
      return { items, hasMore, nextCursor };
    });
  },
  // Number of runs started since a date (home KPI).
  countSince: async (ctx: TenantContext, since: Date) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workspaceId, ctx.workspaceId),
            gte(workflowRuns.createdAt, since),
          ),
        );
      return row?.n ?? 0;
    });
  },
  // Number of runs per status started in [from, to[ (home KPI).
  statusCounts: async (ctx: TenantContext, from: Date, to: Date) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({
          status: workflowRuns.status,
          n: sql<number>`count(*)`.mapWith(Number),
        })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workspaceId, ctx.workspaceId),
            gte(workflowRuns.createdAt, from),
            lt(workflowRuns.createdAt, to),
          ),
        )
        .groupBy(workflowRuns.status);
      return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<
        Record<(typeof RUN_STATUSES)[number], number>
      >;
    });
  },
  // Runs waiting for a human decision (human.approve).
  waiting: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workspaceId, ctx.workspaceId),
            eq(workflowRuns.status, "waiting"),
          ),
        )
        .orderBy(desc(workflowRuns.createdAt)),
    );
  },
  // Compact form for agents: one line per waiting path (no full run rows).
  waitingCompact: async (ctx: TenantContext) => {
    const rows = await runQueries.waiting(ctx);
    return rows.flatMap((r) =>
      Object.entries((r.paths ?? {}) as Paths)
        .filter(([, p]) => p.status === "waiting")
        .map(([path, p]) => ({
          runId: r.id,
          workflowId: r.workflowId,
          recordId: r.recordId,
          path,
          step: p.step,
          message: p.message ?? "",
          since: r.createdAt,
        })),
    );
  },
};

const runConditions = (f: RunFilter) => [
  f.status ? eq(workflowRuns.status, f.status) : undefined,
  f.workflowId ? eq(workflowRuns.workflowId, f.workflowId) : undefined,
  f.recordId ? eq(workflowRuns.recordId, f.recordId) : undefined,
  f.from ? gte(workflowRuns.createdAt, f.from) : undefined,
  f.to ? lte(workflowRuns.createdAt, f.to) : undefined,
];
