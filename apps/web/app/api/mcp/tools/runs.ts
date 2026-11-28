// MCP tools: runs.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import {
  ACTIVE_RUN_STATUSES,
  RUN_STATUSES,
  runsService,
} from "@getrunbase/core/runs";
import { appError, notFound, requireConfirm } from "@getrunbase/core/errors";
import { triggersService } from "@getrunbase/core/triggers";
import { run, must, testFlag, wfId } from "./shared";

export function defineRunTools(server: McpServer, ctx: TenantContext) {
  // Runs
  server.registerTool(
    "runs.start",
    {
      description:
        "Starts a run of a workflow's current version, on an optional record, with an optional event payload (`event`, read by {{event.…}} as if the event had triggered the run). Refused if a run of the same workflow is already active on that record. Refused for a trigger.webhook workflow on an object given an `event` without `recordId` (the mapping would be skipped): use webhooks.test instead. `test: true`: test run, deleted by workspace.purge_test.",
      inputSchema: z.object({
        id: wfId,
        recordId: z.string().optional(),
        event: z.unknown().optional(),
        test: testFlag,
      }),
    },
    ({ id, recordId, event, test }) =>
      run(() =>
        must(
          runsService.start(ctx, id, { recordId, event, test }),
          "Workflow",
          id,
          "See workflows.list.",
        ),
      ),
  );
  server.registerTool(
    "workflows.run_manual",
    {
      description:
        "trigger.manual: starts a workflow on a record or a selection of records (no record = one run without a record). Records that already have an active run are skipped. test: true flags the runs as test (deleted by workspace.purge_test).",
      inputSchema: z.object({
        id: wfId,
        recordIds: z.array(z.string()),
        test: z.boolean().optional(),
      }),
    },
    ({ id, recordIds, test }) =>
      run(() => triggersService.manual(ctx, id, recordIds, { test })),
  );
  server.registerTool(
    "runs.list",
    {
      description:
        "Lists the workspace runs, most recent first, with their cost. Filters: status, workflow, record, period (from/to ISO). Returns { items, hasMore, nextCursor }: pass nextCursor back as cursor for the next page.",
      inputSchema: z.object({
        status: z.enum(RUN_STATUSES).optional(),
        workflowId: z.string().optional(),
        recordId: z.string().optional(),
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
        cursor: z.string().uuid().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Default 50"),
      }),
    },
    ({ from, to, ...filter }) =>
      run(() =>
        runsService.list(ctx, {
          ...filter,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        }),
      ),
  );
  const runId = z.string().describe("Run id");
  server.registerTool(
    "runs.cancel",
    {
      description:
        "Cancels an unfinished run (status canceled): its steps stop and the record can start a run again. false if it is already finished.",
      inputSchema: z.object({ id: runId }),
    },
    ({ id }) => run(() => runsService.cancel(ctx, id)),
  );
  server.registerTool(
    "runs.cancel_bulk",
    {
      description:
        "Cancels all unfinished runs of a workflow and/or a status (at least one filter). confirm: true required. Returns the number of cancelled runs.",
      inputSchema: z.object({
        workflowId: z.string().optional(),
        status: z.enum(ACTIVE_RUN_STATUSES).optional(),
        confirm: z.boolean().optional(),
      }),
    },
    ({ confirm, ...filter }) =>
      run(async () => {
        requireConfirm(
          confirm,
          "runs.bulkCancelConfirm",
          "Bulk run cancellation",
        );
        return runsService.cancelBulk(ctx, filter);
      }),
  );
  server.registerTool(
    "runs.pause",
    {
      description:
        "Pauses a run (status paused): the current step finishes, the next ones wait for runs.resume. false if the run is not running.",
      inputSchema: z.object({ id: runId }),
    },
    ({ id }) => run(() => runsService.pause(ctx, id)),
  );
  server.registerTool(
    "runs.resume",
    {
      description: "Resumes a run paused by runs.pause.",
      inputSchema: z.object({ id: runId }),
    },
    ({ id }) => run(() => runsService.resume(ctx, id)),
  );
  server.registerTool(
    "runs.retry_from",
    {
      description:
        "Retries a finished run (succeeded, failed or cancelled) from a step: that step and the rest of its path are cleared and re-run, earlier steps are kept. Refused if another run is active on the same record.",
      inputSchema: z.object({
        id: runId,
        stepId: z.string().describe("Id of the step to resume from"),
      }),
    },
    ({ id, stepId }) => run(() => runsService.retryFrom(ctx, id, stepId)),
  );
  server.registerTool(
    "runs.replay",
    {
      description:
        "Replays a run: new run of the same workflow version, same record and same input (event included). Returns the new run.",
      inputSchema: z.object({ id: runId }),
    },
    ({ id }) => run(() => runsService.replay(ctx, id)),
  );
  server.registerTool(
    "runs.get",
    {
      description:
        'Reads a run and its steps: path taken (branch; `path` = parallel execution branch, "0", "1", "0.1"…), input, output (AI reasons included; loop: per-iteration details), function logs fn.* (`logs`), startedAt, attempts, duration, cost, error. `paths` gives the state of each path.',
      inputSchema: z.object({ id: z.string().describe("Run id") }),
    },
    ({ id }) =>
      run(() => must(runsService.get(ctx, id), "Run", id, "See runs.list.")),
  );
  server.registerTool(
    "runs.waiting",
    {
      description:
        "Lists runs paused on a human.approve block, waiting for a decision: compact [{ runId, workflowId, recordId, message, since }]. Decide with runs.decide; details with runs.get.",
      inputSchema: z.object({}),
    },
    () => run(() => runsService.waitingCompact(ctx)),
  );
  server.registerTool(
    "runs.decide",
    {
      description:
        "Approves or rejects a paused run (human.approve): it resumes on the approved or rejected branch. Returns { runId, branch, status }; the step output carries { message, approved, by, decidedAt, comment? } (`by` includes decidedBy when given). not_found error (unknown run) or not_waiting (run or path not waiting, with the reason).",
      inputSchema: z.object({
        id: z.string().describe("Run id"),
        approved: z.boolean(),
        path: z
          .string()
          .optional()
          .describe("Waiting path to decide (default: the first)"),
        comment: z
          .string()
          .optional()
          .describe("Reason for the decision, stored in the step output"),
        decidedBy: z
          .string()
          .optional()
          .describe(
            "Who decided (e.g. the user's name when an agent relays their answer), stored in the output's `by`",
          ),
      }),
    },
    ({ id, approved, path, comment, decidedBy }) =>
      run(async () => {
        const decided = await runsService.decide(
          ctx,
          id,
          approved,
          path,
          comment,
          decidedBy,
        );
        if (decided) return decided;
        const r = await runsService.get(ctx, id);
        if (!r)
          throw notFound(
            "runs.notFound",
            "Run {id} not found. See runs.waiting.",
            {
              id,
            },
          );
        const waiting = Object.entries(
          r.paths as Record<string, { status: string }>,
        )
          .filter(([, p]) => p.status === "waiting")
          .map(([k]) => k);
        const kind = { kind: "not_waiting" } as const;
        throw path && waiting.length
          ? appError(
              "runs.pathNotWaiting",
              "Path {path} is not waiting; waiting paths: {waiting}.",
              { path, waiting: waiting.join(", ") },
              kind,
            )
          : appError(
              "runs.notWaiting",
              "Run {id} is not waiting for a decision (status: {status}). See runs.waiting.",
              { id, status: r.status },
              kind,
            );
      }),
  );
}
