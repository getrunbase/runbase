// MCP tools: events, API keys, feedback, audit and blocks.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import { eventsService } from "@getrunbase/core/events";
import { apiKeysService } from "@getrunbase/core/api-keys";
import { auditService } from "@getrunbase/core/audit";
import { FEEDBACK_KINDS, feedbackService } from "@getrunbase/core/feedback";
import { blocksService } from "@getrunbase/core/blocks";
import { run, data, testFlag } from "./shared";

export function definePlatformTools(server: McpServer, ctx: TenantContext) {
  // Events
  server.registerTool(
    "events.push",
    {
      description:
        "Records an event, linked to a record or not. `idempotencyKey` (external id): a second push with the same key returns the existing event (`duplicate: true`) without re-triggering workflows. `test: true`: test event, deleted by workspace.purge_test.",
      inputSchema: z.object({
        test: testFlag,
        type: z.string().min(1),
        recordId: z.string().optional(),
        payload: data.optional(),
        // ISO string: z.date() cannot be represented in JSON Schema (tools/list).
        occurredAt: z.iso.datetime({ offset: true }).optional(),
        source: z.string().optional(),
        idempotencyKey: z.string().optional(),
      }),
    },
    ({ occurredAt, ...input }) =>
      run(() =>
        eventsService.insert(ctx, {
          ...input,
          occurredAt: occurredAt ? new Date(occurredAt) : undefined,
        }),
      ),
  );
  server.registerTool(
    "events.list",
    {
      description:
        "Workspace events. With only `recordId`: chronological timeline of that record (array). Otherwise filters `type`, `recordId`, `from`/`to` (ISO, event date), newest to oldest, paginated: returns { items, hasMore, nextCursor }; next page with `cursor` = nextCursor.",
      inputSchema: z.object({
        recordId: z.string().optional(),
        type: z.string().optional(),
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    ({ from, to, ...f }) =>
      run(() =>
        f.recordId && !f.type && !from && !to && !f.cursor && !f.limit
          ? eventsService.timeline(ctx, f.recordId)
          : eventsService.list(ctx, {
              ...f,
              from: from ? new Date(from) : undefined,
              to: to ? new Date(to) : undefined,
            }),
      ),
  );
  server.registerTool(
    "events.types",
    {
      description:
        "Event types already received in the workspace (excluding the internal record.* timeline): values usable in trigger.event.",
      inputSchema: z.object({}),
    },
    () => run(() => eventsService.types(ctx)),
  );
  server.registerTool(
    "events.funnel",
    {
      description:
        "Funnel: number of distinct records that received each event type, in the given order.",
      inputSchema: z.object({ types: z.array(z.string()).min(1) }),
    },
    ({ types }) => run(() => eventsService.funnel(ctx, types)),
  );

  // API keys (admin scope, checked by the service)
  server.registerTool(
    "api_keys.create",
    {
      description:
        'Creates an API key (admin scope). The plaintext key is returned only once. The key only sees its `workspaceIds`. Optional restrictions: `tools` (allowed MCP tool names, e.g. ["records.search", "records.upsert"]; the others are hidden) and `objects` (visible object slugs: other objects and their records stay invisible, query.sql unavailable). Absent = everything.',
      inputSchema: z.object({
        name: z.string().min(1),
        scopes: z.array(z.enum(["read", "write", "admin"])).min(1),
        workspaceIds: z.array(z.string()).min(1),
        tools: z.array(z.string()).optional(),
        objects: z.array(z.string()).optional(),
      }),
    },
    (input) => run(() => apiKeysService.create(ctx, input)),
  );
  server.registerTool(
    "api_keys.list",
    { description: "Lists the organization's API keys (admin scope)." },
    () => run(() => apiKeysService.list(ctx)),
  );
  server.registerTool(
    "api_keys.revoke",
    {
      description: "Revokes an API key (admin scope).",
      inputSchema: z.object({ id: z.string() }),
    },
    ({ id }) => run(() => apiKeysService.revoke(ctx, id)),
  );

  // Product feedback (bugs, limits, ideas): read by the Runbase team.
  server.registerTool(
    "feedback.send",
    {
      description:
        "Sends feedback to the Runbase team, which reads it to improve the product. Call it without waiting to be asked as soon as: a tool misbehaves or returns an unexpected error (`bug`), a capability is missing and you have to work around it or give up (`limit`), you see a useful improvement (`idea`), or to describe what the user was trying to do (`usage`). Be factual: what you were trying, the exact call, actual vs expected result, the workaround. Never any secret or personal data.",
      inputSchema: z.object({
        kind: z.enum(FEEDBACK_KINDS),
        title: z.string().min(3).max(200).describe("One-line summary"),
        details: z
          .string()
          .min(10)
          .max(10000)
          .describe("Context, steps, expected vs actual, workaround"),
        tool: z.string().max(100).optional().describe("Tool involved"),
        context: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Useful data: arguments, error message, ids"),
      }),
    },
    (input) => run(() => feedbackService.send(ctx, input)),
  );

  // Audit (read)
  server.registerTool(
    "audit.list",
    {
      description:
        "Workspace audit log (who, what, when), most recent first. Without filter: the whole feed. Filters: `type` and `id` (one resource: record, workflow, function…), `action` (exact, or prefix ending with a dot: `record.`), `actorUserId`, `actorApiKeyId`, `from`/`to` (ISO). Returns { items, hasMore, nextCursor }; next page with `cursor` = nextCursor.",
      inputSchema: z.object({
        type: z.string().min(1).optional(),
        id: z.string().optional(),
        action: z.string().optional(),
        actorUserId: z.string().optional(),
        actorApiKeyId: z.string().optional(),
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    ({ type, id, from, to, ...f }) =>
      run(() =>
        auditService.list(ctx, {
          ...f,
          resourceType: type,
          resourceId: id,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        }),
      ),
  );

  // Blocks
  server.registerTool(
    "blocks.list",
    {
      description:
        "Catalog of workflow blocks: type, branches, input and output JSON schemas. Includes the workspace functions as fn.<name>.",
    },
    () => run(() => blocksService.list(ctx)),
  );
}
