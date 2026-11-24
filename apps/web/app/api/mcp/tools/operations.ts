// MCP tools: AI budget, overview and error center.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import { runsService } from "@getrunbase/core/runs";
import { errorsService } from "@getrunbase/core/errors";
import { overviewService } from "@getrunbase/core/overview";
import { run } from "./shared";

export function defineOperationTools(server: McpServer, ctx: TenantContext) {
  // Monthly workspace AI budget
  server.registerTool(
    "workspaces.ai_budget",
    {
      description:
        "Monthly AI budget of the workspace: USD cap, spend this month, exhausted or not.",
      inputSchema: z.object({}),
    },
    () => run(() => runsService.budget(ctx)),
  );
  server.registerTool(
    "workspaces.set_ai_budget",
    {
      description:
        "Sets the monthly AI budget in USD (null = unlimited). At 100% AI blocks are blocked and runs move to paused_budget; they resume if the budget is raised. Capped by the account limit (quota:aiBudgetUsd): a higher value is refused. There is no platform AI key: without the workspace's own provider key, AI calls fail with ai.providerNotConfigured.",
      inputSchema: z.object({ budgetUsd: z.number().positive().nullable() }),
    },
    ({ budgetUsd }) => run(() => runsService.setBudget(ctx, budgetUsd)),
  );

  // Overview and test data
  server.registerTool(
    "workspace.describe",
    {
      description:
        "The whole workspace in one call: databases > objects (fields, record count), workflows (trigger, steps, status), functions (schemas, permissions, limits), webhooks, pages, secret names, SQL views readable by query.sql (name, columns, types), counters (records, events, active runs, open errors). Call it first to discover a workspace.",
      inputSchema: z.object({}),
    },
    () => run(() => overviewService.describe(ctx)),
  );
  server.registerTool(
    "workspace.purge_test",
    {
      description:
        "Deletes test data (created with test: true): records (trash then purge, relations removed), finished events and runs (a still-active run is kept: runs.cancel first). dryRun: true returns the counts without deleting anything; otherwise confirm: true required. hasMore: call again for the next batch.",
      inputSchema: z.object({
        dryRun: z.boolean().optional(),
        confirm: z.boolean().optional(),
      }),
    },
    (opts) => run(() => overviewService.purgeTest(ctx, opts)),
  );

  // Error center
  const errorId = z.string().describe("Error id");
  server.registerTool(
    "errors.list",
    {
      description:
        "Lists the workspace errors (ingest, workflow, function = function call from a page, mcp = failing MCP tool, component = code component failing in a user's browser; payload {page, block}), most recent first. Filters: source, status, run, workflow, record, period (from/to ISO). Returns { items, hasMore, nextCursor }: pass nextCursor back as cursor for the next page.",
      inputSchema: z.object({
        source: z
          .enum(["ingest", "workflow", "function", "mcp", "component"])
          .optional(),
        status: z.enum(["open", "resolved"]).optional(),
        runId: z.string().optional(),
        workflowId: z.string().optional(),
        recordId: z.string().optional(),
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
        group: z
          .boolean()
          .optional()
          .describe(
            "One item per fingerprint (same normalized message): the latest, with count and lastAt",
          ),
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
    ({ from, to, ...f }) =>
      run(() =>
        errorsService.list(ctx, {
          ...f,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        }),
      ),
  );
  server.registerTool(
    "errors.get",
    {
      description: "Reads an error: reference, message, payload, stack.",
      inputSchema: z.object({ id: errorId }),
    },
    ({ id }) => run(() => errorsService.get(ctx, id)),
  );
  server.registerTool(
    "errors.retry",
    {
      description:
        "Replays an error: re-ingests the rejected payload, or retries the run's failed step. Resolved if the replay succeeds.",
      inputSchema: z.object({ id: errorId }),
    },
    ({ id }) => run(() => errorsService.retry(ctx, id)),
  );
  server.registerTool(
    "errors.resolve",
    {
      description: "Marks an error as resolved.",
      inputSchema: z.object({ id: errorId }),
    },
    ({ id }) => run(() => errorsService.resolve(ctx, id)),
  );
}
