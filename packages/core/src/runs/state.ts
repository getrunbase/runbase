// Shared run state: constants, path types, run status derivation and joins.
import { runStatus, workflowRuns } from "../db/schema";
import { type TenantContext } from "../tenant";
import { AppError } from "../errors/app-error";
import { env } from "../env";

export const RUNS_QUEUE = "workflow-runs";
export const MAX_STEPS = 50;
export const RUN_STATUSES = runStatus.enumValues;
// Jobs processed in parallel per worker (WORKER_CONCURRENCY, default 10).
export const workerConcurrency = () => env().WORKER_CONCURRENCY;
// Statuses of an unfinished run.
export const ACTIVE_RUN_STATUSES = [
  "running",
  "waiting",
  "paused_budget",
  "paused",
] as const;
export const FINISHED: string[] = ["succeeded", "failed", "canceled"];

// The job carries the tenant context of the actor who started the run, the path
// and the rank `n` of the step on that path (`seq`: jobs from before paths).
export type StepJob = TenantContext & {
  runId: string;
  path?: string;
  n?: number;
  seq?: number;
  // Current attempt of the step (0 = first).
  attempt?: number;
  // Manual run (workflows.run_manual): prioritized in its queue.
  urgent?: true;
  // Counted in the tenant backlog (queues/fair).
  fq?: 1;
  // Outbox row of the job, deleted once processed.
  ob?: string;
};
// Context carried by jobs: tenant + run priority.
export type RunCtx = TenantContext & { urgent?: true };
export type Step = {
  id: string;
  type: string;
  input?: unknown;
  join?: boolean;
};
export type PathStatus =
  | "running"
  | "waiting"
  | "paused_budget"
  | "joined"
  | "done"
  | "failed"
  | "canceled";
// State of a path: step to run (or last run), rank, status;
// `failedSeq`: failed run_step, cleared by retryRun.
export type PathState = {
  step: string;
  n: number;
  status: PathStatus;
  failedSeq?: number;
};
export type Paths = Record<string, PathState>;

export const parseJob = ({ runId, path, n, seq, attempt, ...ctx }: StepJob) => {
  delete ctx.fq;
  delete ctx.ob;
  return {
    runId,
    path: path ?? "0",
    n: n ?? seq ?? 0,
    attempt: attempt ?? 0,
    ctx: ctx as RunCtx,
  };
};

export type PathRef = { runId: string; path: string; n: number };

export const ACTIVE: PathStatus[] = ["running", "waiting", "paused_budget"];

// Unique constraint violated (direct Postgres error or wrapped by
// Drizzle): constraint name, otherwise undefined.
export function uniqueViolation(e: unknown) {
  const err = ((e as { cause?: unknown }).cause ?? e) as {
    code?: string;
    constraint_name?: string;
  };
  return err.code === "23505" ? (err.constraint_name ?? "unique") : undefined;
}

export class RunAlreadyActive extends AppError {
  constructor() {
    super(
      "runs.alreadyActive",
      "A run of this workflow is already active on this record",
      {},
      { kind: "conflict" },
    );
  }
}

export type RunFilter = {
  status?: (typeof RUN_STATUSES)[number];
  workflowId?: string;
  recordId?: string;
  // Started from / until.
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
};

// Waiting for a turn on the concurrency key: new attempt after this delay.
export const CONCURRENCY_POLL_MS = 2000;

export type RunRow = typeof workflowRuns.$inferSelect;
// Path of a parent run waiting for a sub-workflow (workflow.run).
export type ParentRef = { runId: string; path: string; n: number };

// Original tenant context of the run (actor who started it).
export const runCtx = (run: typeof workflowRuns.$inferSelect): RunCtx => ({
  organizationId: run.organizationId,
  workspaceId: run.workspaceId,
  actor: run.actor as TenantContext["actor"],
  ...(run.isTest && { test: true }),
  ...((run.input as { manual?: boolean } | null)?.manual && {
    urgent: true as const,
  }),
});

// Run status derived from its paths: human wait shown first, then
// running, budget pause; finished when no path is active anymore.
// `prev`: current status; a manual pause stays a pause while the run
// is not finished, a cancellation is final.
export function runState(paths: Paths, prev?: (typeof RUN_STATUSES)[number]) {
  const all = Object.values(paths);
  const has = (st: PathStatus) => all.some((p) => p.status === st);
  const status: (typeof RUN_STATUSES)[number] = has("waiting")
    ? "waiting"
    : has("running")
      ? "running"
      : has("paused_budget")
        ? "paused_budget"
        : has("failed")
          ? "failed"
          : "succeeded";
  const active =
    all.find((p) => p.status === "waiting") ??
    all.find((p) => p.status === "running" || p.status === "paused_budget");
  const finished = status === "succeeded" || status === "failed";
  if (prev === "canceled")
    return { status: prev, currentStep: null, finishedAt: new Date() };
  return {
    status: prev === "paused" && !finished ? prev : status,
    currentStep: active?.step ?? null,
    finishedAt: finished ? new Date() : null,
  };
}

// Joins: when no path is active anymore, the smallest path waiting
// on each `join` step restarts, the others are closed. Mutates `paths`.
export function releaseJoins(runId: string, paths: Paths): PathRef[] {
  const all = Object.entries(paths);
  if (all.some(([, p]) => ACTIVE.includes(p.status))) return [];
  const seen = new Set<string>();
  const out: PathRef[] = [];
  for (const [id, p] of all.sort(([a], [b]) => a.localeCompare(b))) {
    if (p.status !== "joined") continue;
    if (seen.has(p.step)) paths[id] = { ...p, status: "done" };
    else {
      seen.add(p.step);
      paths[id] = { ...p, status: "running" };
      out.push({ runId, path: id, n: p.n });
    }
  }
  return out;
}

// Visible outputs of a path (`{{steps.<id>.output}}`): those of its
// ancestry (path and parent paths) take precedence over those of parallel
// paths; a failed step does not overwrite a successful output. A step that
// failed with continueOnFail (output `{ error }` stored) stays visible as
// `{ output: { error }, error }` so the next steps can read the failure.
export function stepsScope(
  done: {
    stepId: string;
    path: string;
    output: unknown;
    error: string | null;
  }[],
  path: string,
) {
  const mine = (p: string) => path === p || path.startsWith(`${p}.`);
  const ordered = [
    ...done.filter((s) => !mine(s.path)),
    ...done.filter((s) => mine(s.path)),
  ];
  const scope: Record<string, { output: unknown; error?: string }> = {};
  for (const s of ordered) {
    if (!s.error) scope[s.stepId] = { output: s.output };
    else if (s.output != null && !(s.stepId in scope && !scope[s.stepId]!.error))
      scope[s.stepId] = { output: s.output, error: s.error };
  }
  return scope;
}
