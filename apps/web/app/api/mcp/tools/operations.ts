// MCP tools: AI budget, overview and error center.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import { runsService } from "@getrunbase/core/runs";
import { cleanStack, errorsService } from "@getrunbase/core/errors";
import { overviewService } from "@getrunbase/core/overview";
import { workspacesService } from "@getrunbase/core/workspaces";
import { run } from "./shared";

export function defineOperationTools(server: McpServer, ctx: TenantContext) {
  // Monthly workspace AI budget
  server.registerTool(
    "workspaces.ai_budget",
    {
      description:
        "Monthly AI budget of the workspace (admin scope): USD cap, spend this month, exhausted or not.",
      inputSchema: z.object({}),
    },
    () => run(() => runsService.budget(ctx)),
  );
  server.registerTool(
    "workspaces.set_ai_budget",
    {
      description:
        "Sets the monthly AI budget in USD (null = unlimited). At 100% AI blocks are blocked and runs move to paused_budget; they resume if the budget is raised. Capped by the account limit (quota:aiBudgetUsd): a higher value is refused. There is no platform AI key and no workspace default AI: each AI block (`ai` in its input) and each page (`permissions.ai`) names its provider, model and key secret.",
      inputSchema: z.object({ budgetUsd: z.number().positive().nullable() }),
    },
    ({ budgetUsd }) => run(() => runsService.setBudget(ctx, budgetUsd)),
  );

  // Workspace settings
  server.registerTool(
    "workspace.settings",
    {
      description:
        "Workspace settings: `allowedDomains` (hostnames that http and other external blocks may call; empty = none), MCP server names, `lintStrict` (lint warnings block saves). Read it before adding an http block to an unknown domain; changing it is done by an admin in the UI (hand that step back).",
      inputSchema: z.object({}),
    },
    () => run(() => workspacesService.getSettings(ctx)),
  );

  // Overview and test data
  server.registerTool(
    "workspace.describe",
    {
      description:
        "The whole workspace in one call: databases > objects (fields, record count), workflows (trigger, steps, status), functions (schemas, permissions, limits), webhooks, pages, secret names, SQL views readable by query.sql (name, columns, types), counters (records, events, active runs, open errors), note titles per entity (notes: id, title, stale; bodies via notes.get), and a generated dependency map: per workflow the objects/fields it reads and writes, functions called and external domains; `dependencies` maps each object field (`object.field`) to its writers and readers (workflow:<name>#<step>, function:<name>, page:<name>), from static analysis of workflow definitions, function code and published pages. Call it first to discover a workspace.",
      inputSchema: z.object({}),
    },
    () => run(() => overviewService.describe(ctx)),
  );
  server.registerTool(
    "workspace.dependencies",
    {
      description:
        "Generated dependency map (static analysis of workflow definitions, function code and published pages, no input needed). `entity`: `object.field` (e.g. leads.status) returns its writers and readers; `object` (slug) its fields and users; `workflow:<name>` its trigger, steps, objects/fields touched, functions and external domains; `function:<name>` or `page:<name>` the fields they touch. Without entity: the whole map. References: workflow:<name>#<step> (#trigger = the trigger), function:<name>, page:<name>. Keys built at runtime are not detected.",
      inputSchema: z.object({ entity: z.string().min(1).optional() }),
    },
    ({ entity }) => run(() => overviewService.dependencies(ctx, entity)),
  );
  server.registerTool(
    "workspace.purge_test",
    {
      description:
        "Deletes test data (created with test: true): records (trash then purge, relations removed), finished events and runs (a still-active run is kept: runs.cancel first). dryRun: true returns the counts without deleting anything; otherwise confirm: true required. hasMore: call again for the next batch. A test record updated without test: true is adopted as live (promoted) and no longer purged here.",
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
        "Lists the workspace errors (ingest, workflow, function = function call from a page, mcp = failing MCP tool, component = code component failing in a user's browser; payload {page, block}), most recent first. Without `source`, mcp errors (your own failed tool calls) are left out. No stack: read it with errors.get. Filters: source, status, run, workflow, record, period (from/to ISO). Returns { items, hasMore, nextCursor }: pass nextCursor back as cursor for the next page.",
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
      run(async () => {
        const page = await errorsService.list(ctx, {
          ...f,
          excludeSources: ["mcp"],
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        });
        return {
          ...page,
          items: page.items.map((e) => ({ ...e, stack: undefined })),
        };
      }),
  );
  server.registerTool(
    "errors.get",
    {
      description: "Reads an error: reference, message, payload, stack.",
      inputSchema: z.object({ id: errorId }),
    },
    ({ id }) =>
      run(async () => {
        const e = await errorsService.get(ctx, id);
        // Rows stored before path cleanup: no server path in the payload.
        return e && { ...e, stack: e.stack ? cleanStack(e.stack) : e.stack };
      }),
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
