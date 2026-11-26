// SDK bridge for code components: each call coming from the iframe is validated
// (strict shape, size), checked against the permissions declared by the
// component, then executed by the matching service. Nothing else is
// reachable from the component.
import { z } from "zod";
import { filterSchema } from "../filter";
import { pageAi } from "../ai";
import { aiConfigSchema } from "../ai-providers";
import { eventsService } from "../events";
import { filesService } from "../files";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { runsService } from "../runs";
import type { TenantContext } from "../tenant";
import { appError, notFound } from "../errors/app-error";

export const MAX_CALL = 64_000;
// useUpload: base64 file in the call, dedicated cap.
export const MAX_UPLOAD_CALL = 7_000_000;

// AI config name (permissions.ai key, useAI(name)).
const AI_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,49}$/;
const names = z.array(z.string().min(1).max(200)).max(100).default([]);
// Row cap per useQuery (KPIs: prefer server-side groupBy/aggregate).
export const MAX_QUERY_LIMIT = 1000;

export const permissionsSchema = z
  .strictObject({
    objects: names.describe(
      "readable object ids (useQuery, useRecord, useTimeline, useObject)",
    ),
    write: names.describe(
      "writable object ids (useMutation: create, update, remove); `objects` is not enough",
    ),
    workflows: names.describe(
      "ids of workflows it may start and follow (startWorkflow, useRun)",
    ),
    files: z.boolean().default(false).describe("may upload files (useUpload)"),
    ai: z
      .record(z.string().regex(AI_NAME), aiConfigSchema)
      .refine((r) => Object.keys(r).length <= 20, "at most 20 AI configs")
      .default({})
      .describe(
        'AI configs the page may call (useAI): { default?: { provider, model, secret }, <name>: {...} }. useAI() uses `default`, useAI("<name>") a named one. Empty = no AI. The key secret is read server-side, never sent to the page. Counted in the workspace AI budget, rate limited',
      ),
  })
  .default({
    objects: [],
    write: [],
    workflows: [],
    files: false,
    ai: {},
  });
export type ComponentPermissions = z.output<typeof permissionsSchema>;

const id = z.string().max(200);
const data = z.record(z.string().max(200), z.unknown());
const groupBy = z
  .union([z.string().max(200), z.array(z.string().max(200)).max(3)])
  .optional();
const aggregate = z
  .array(
    z.strictObject({
      op: z.enum(["count", "sum", "avg", "min", "max"]),
      field: z.string().max(200).optional(),
      as: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,49}$/),
    }),
  )
  .max(10);
export const sdkCallSchema = z.discriminatedUnion("method", [
  z.strictObject({
    method: z.literal("query"),
    args: z.strictObject({
      object: id,
      filter: filterSchema.optional(),
      sort: z
        .array(
          z.strictObject({
            field: z.string().max(200),
            dir: z.enum(["asc", "desc"]).optional(),
          }),
        )
        .max(5)
        .optional(),
      q: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(MAX_QUERY_LIMIT).optional(),
      // Keyset cursor: id of the last row of the previous page.
      after: z.string().max(100).optional(),
      groupBy,
      aggregate: aggregate.optional(),
    }),
  }),
  // useAggregate: groupBy + aggregations computed server-side.
  z.strictObject({
    method: z.literal("aggregate"),
    args: z.strictObject({
      object: id,
      filter: filterSchema.optional(),
      q: z.string().max(200).optional(),
      groupBy,
      aggregate,
      limit: z.number().int().min(1).max(MAX_QUERY_LIMIT).optional(),
    }),
  }),
  z.strictObject({
    method: z.literal("record"),
    args: z.strictObject({
      id: z.uuid(),
      include: z.array(z.string().max(200)).max(10).optional(),
    }),
  }),
  z.strictObject({
    method: z.literal("timeline"),
    args: z.strictObject({ recordId: z.uuid() }),
  }),
  z.strictObject({
    method: z.literal("object"),
    args: z.strictObject({ id }),
  }),
  z.strictObject({ method: z.literal("user"), args: z.strictObject({}) }),
  z.strictObject({
    method: z.literal("create"),
    args: z.strictObject({ object: id, data }),
  }),
  z.strictObject({
    method: z.literal("update"),
    args: z.strictObject({ id: z.uuid(), patch: data }),
  }),
  z.strictObject({
    method: z.literal("delete"),
    args: z.strictObject({ id: z.uuid() }),
  }),
  z.strictObject({
    method: z.literal("workflow"),
    args: z.strictObject({ id: z.uuid(), recordId: z.uuid().optional() }),
  }),
  // useRun: status of a run started by startWorkflow.
  z.strictObject({
    method: z.literal("run"),
    args: z.strictObject({ id: z.uuid() }),
  }),
  // useUpload: to files.upload; returns the value of a `file` field.
  z.strictObject({
    method: z.literal("upload"),
    args: z.strictObject({
      name: z.string().min(1).max(200),
      type: z.string().max(200).optional(),
      base64: z.string().max(MAX_UPLOAD_CALL),
    }),
  }),
  // useAI: text completion, server-side cost guard (../ai).
  z.strictObject({
    method: z.literal("ai"),
    args: z.strictObject({
      prompt: z.string().min(1).max(20_000),
      system: z.string().max(4000).optional(),
      // permissions.ai key; absent = `default`.
      name: z.string().regex(AI_NAME).optional(),
    }),
  }),
]);
export type SdkCall = z.infer<typeof sdkCallSchema>;

// Reads (captures: the only ones executed, the rest is simulated).
export const READ_METHODS = [
  "query",
  "aggregate",
  "record",
  "timeline",
  "object",
  "user",
  "run",
];
export const WRITE_METHODS = ["create", "update", "delete", "upload", "ai"];

// Refusal message, or null if the call is allowed (before execution; record,
// timeline, update and delete are rechecked against the object of the read record).
export function denied(p: ComponentPermissions, call: SdkCall): string | null {
  const no = (what: string, v: string, list: string[]) =>
    list.includes(v)
      ? null
      : `${what} not allowed: ${v} (permissions: ${list.join(", ") || "none"})`;
  switch (call.method) {
    case "query":
    case "aggregate":
      return no("object", call.args.object, p.objects);
    case "object":
      return no("object", call.args.id, p.objects);
    case "record":
    case "timeline":
    case "user":
      return null;
    case "create":
      return no("write on object", call.args.object, p.write);
    case "update":
    case "delete":
      return p.write.length
        ? null
        : "write not allowed (permissions.write is empty)";
    case "workflow":
      return no("workflow", call.args.id, p.workflows);
    case "run":
      return p.workflows.length
        ? null
        : "run not allowed (permissions.workflows is empty)";
    case "upload":
      return p.files ? null : "upload not allowed (permissions.files is false)";
    case "ai":
      return Object.keys(p.ai).length
        ? null
        : "ai not allowed (permissions.ai declares no AI config)";
  }
}

type Rec = { id: string; objectId: string } & Record<string, unknown>;
// Linked record visible only if its object is readable, otherwise an opaque {id}.
const visible = (p: ComponentPermissions, r: Rec | null) =>
  r && (p.objects.includes(r.objectId) ? r : { id: r.id });

export function parseCall(raw: unknown): SdkCall {
  const max =
    (raw as { method?: unknown } | null)?.method === "upload"
      ? MAX_UPLOAD_CALL + 1000
      : MAX_CALL;
  if (JSON.stringify(raw ?? null).length > max)
    throw appError("sdk.callTooLarge", "SDK call too large (max {max} bytes)", {
      max,
    });
  const r = sdkCallSchema.safeParse(raw);
  if (!r.success)
    throw appError("sdk.invalidCall", "Invalid SDK call:\n{detail}", {
      detail: z.prettifyError(r.error),
    });
  return r.data;
}

export async function handleSdkCall(
  ctx: TenantContext,
  perms: ComponentPermissions,
  raw: unknown,
  host: {
    user?: Record<string, unknown> | null;
    // Host page: AI rate limit key.
    pageId?: string;
  } = {},
): Promise<unknown> {
  const call = parseCall(raw);
  const refused = denied(perms, call);
  if (refused) throw appError("sdk.denied", "{reason}", { reason: refused });
  const objectOf = async (recordId: string, list: string[], what: string) => {
    const r = await recordsService.get(ctx, recordId);
    if (!list.includes(r.objectId))
      throw appError("sdk.notAllowed", "{what} not allowed: {id}", {
        what,
        id: r.objectId,
      });
    return r;
  };
  switch (call.method) {
    case "query": {
      const { object, filter, sort, q, limit, after, groupBy, aggregate } =
        call.args;
      const pagination = { limit: limit ?? 50, after };
      if (groupBy || aggregate) {
        const rows = await recordsService.aggregate(ctx, object, {
          filter,
          q,
          groupBy,
          aggregate,
          pagination,
        });
        return { rows, total: rows.length };
      }
      const [rows, [count]] = await Promise.all([
        recordsService.search(ctx, object, { filter, sort, q, pagination }),
        recordsService.aggregate(ctx, object, { filter, q }),
      ]);
      // Keyset (useInfiniteQuery): `next` to pass back as `after`.
      const next =
        rows.length === pagination.limit
          ? String((rows.at(-1) as { id: string }).id)
          : null;
      return { rows, total: Number(count?.count ?? rows.length), next };
    }
    case "aggregate": {
      const { object, limit, ...rest } = call.args;
      const rows = await recordsService.aggregate(ctx, object, {
        ...rest,
        pagination: { limit: limit ?? 100 },
      });
      return { rows, total: rows.length };
    }
    case "record": {
      const r = (await recordsService.get(ctx, call.args.id, {
        include: call.args.include,
      })) as unknown as Rec & {
        refs: Record<string, Rec | null>;
        included: Record<string, Rec | Rec[] | null>;
      };
      if (!perms.objects.includes(r.objectId))
        throw appError("sdk.notAllowed", "{what} not allowed: {id}", {
          what: "object",
          id: r.objectId,
        });
      // refs/included: records of other objects, filtered by permissions.
      const map = <T>(o: Record<string, T>, f: (v: T) => unknown) =>
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
      return {
        ...r,
        refs: map(r.refs, (v) => visible(perms, v)),
        included: map(r.included, (v) =>
          Array.isArray(v)
            ? v.filter((x) => perms.objects.includes(x.objectId))
            : visible(perms, v),
        ),
      };
    }
    case "timeline": {
      await objectOf(call.args.recordId, perms.objects, "object");
      const rows = await eventsService.timeline(ctx, call.args.recordId);
      return rows.slice(-200);
    }
    case "object": {
      const o = (await objectsService.list(ctx)).find(
        (x) => x.id === call.args.id,
      );
      if (!o)
        throw notFound("sdk.objectNotFound", "object not found: {id}", {
          id: call.args.id,
        });
      return { id: o.id, slug: o.slug, name: o.name, fields: o.fields };
    }
    case "user":
      return host.user ?? null;
    case "create": {
      const r = await recordsService.upsert(ctx, {
        objectId: call.args.object,
        data: call.args.data,
      });
      return r.record;
    }
    case "update": {
      await objectOf(call.args.id, perms.write, "write on object");
      return (await recordsService.update(ctx, call.args.id, call.args.patch))
        .record;
    }
    case "delete": {
      await objectOf(call.args.id, perms.write, "write on object");
      await recordsService.remove(ctx, call.args.id);
      return { id: call.args.id, deleted: true };
    }
    case "workflow": {
      const run = await runsService.start(ctx, call.args.id, {
        recordId: call.args.recordId,
      });
      if (!run)
        throw notFound("sdk.workflowNotFound", "workflow not found: {id}", {
          id: call.args.id,
        });
      return { runId: run.id, status: run.status };
    }
    case "run": {
      const run = await runsService.get(ctx, call.args.id);
      if (!run || !perms.workflows.includes(run.workflowId))
        throw notFound("sdk.runNotFound", "run not found: {id}", {
          id: call.args.id,
        });
      return {
        runId: run.id,
        status: run.status,
        error: run.error ?? null,
        finishedAt: run.finishedAt ?? null,
      };
    }
    case "upload":
      return filesService.upload(ctx, call.args);
    case "ai":
      return pageAi(ctx, host.pageId ?? "-", perms.ai, call.args);
  }
}
