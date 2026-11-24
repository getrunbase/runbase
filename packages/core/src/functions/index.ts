// Versioned functions: each save creates an immutable
// version. A workflow references a function by name (latest version) or
// by pinned version: `get(ctx, name, version?)`.
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireScope } from "../api-keys";
import { decryptAll, redact } from "../secrets";
import {
  assertDomains,
  domainError,
  execFunction,
  FunctionError,
  LIMITS,
  type HostBridge,
  type SandboxFunction,
} from "./sandbox";
import { objectsService } from "../objects";
import { AppError, appError, notFound } from "../errors/app-error";
import { recordError } from "../errors/record";
import { isUuid } from "../lib/uuid";
import { recordsService } from "../records";
import { eventsService, type EventFilter, type EventInput } from "../events";
import { audit } from "../audit";
import { functionLogs, functions } from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../tenant";

export const functionInputSchema = z.object({
  // Strict kebab-case: the name is used as is as a URL segment.
  name: z.string().superRefine((n, c) => {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n))
      c.addIssue({
        code: "custom",
        message: appError(
          "functions.invalidName",
          "Invalid function name {name}: use kebab-case (a-z, 0-9, single hyphens), e.g. score-lead",
          { name: n },
        ).message,
      });
  }),
  code: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()).default({}),
  outputSchema: z.record(z.string(), z.unknown()).default({}),
  permissions: z
    .object({
      // FQDN or host:port, or "*": see domainError.
      domains: z
        .array(
          z.string().superRefine((d, c) => {
            const e = domainError(d);
            if (e) c.addIssue({ code: "custom", message: e.message });
          }),
        )
        .default([]),
      secrets: z.array(z.string()).default([]),
      // Records SDK in the sandbox (fn-sdk): missing = no access.
      records: z.enum(["read", "write"]).optional(),
      // Events SDK (events.push, events.list): missing = no access.
      events: z.enum(["read", "write"]).optional(),
    })
    .default({ domains: [], secrets: [] }),
  // Execution limits, bounded (default 30 s and 128 MB).
  limits: z
    .object({
      timeoutMs: z
        .number()
        .int()
        .min(LIMITS.timeoutMs.min)
        .max(LIMITS.timeoutMs.max)
        .optional(),
      memoryMb: z
        .number()
        .int()
        .min(LIMITS.memoryMb.min)
        .max(LIMITS.memoryMb.max)
        .optional(),
    })
    .default({}),
});
export type FunctionInput = z.input<typeof functionInputSchema>;
export type FunctionRow = typeof functions.$inferSelect;

const byName = (ctx: TenantContext, name: string) =>
  and(eq(functions.workspaceId, ctx.workspaceId), eq(functions.name, name));

async function find(
  tx: Tx,
  ctx: TenantContext,
  name: string,
  version?: number,
) {
  const [row] = await tx
    .select()
    .from(functions)
    .where(
      version === undefined
        ? byName(ctx, name)
        : and(byName(ctx, name), eq(functions.version, version)),
    )
    .orderBy(desc(functions.version))
    .limit(1);
  return row ?? null;
}

async function insert(
  tx: Tx,
  ctx: TenantContext,
  f: z.output<typeof functionInputSchema>,
) {
  const version = ((await find(tx, ctx, f.name))?.version ?? 0) + 1;
  const [row] = await tx
    .insert(functions)
    .values({
      ...f,
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      version,
    })
    .returning();
  return row!;
}

// Sandbox host bridge (fn-sdk): packages/core services under the
// calling workspace context, gated by the function's `permissions.records` and
// `permissions.events`. Events methods: `events.push`
// (insert, write) and `events.list` (read). `records.search` and
// `records.upsert` accept an object slug instead of the uuid.
// `writes` (dry run): writes are simulated and collected, not performed.
const READ = ["get", "search"];
const WRITE = ["upsert", "update", "transact", "delete", "merge"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Perms = { records?: "read" | "write"; events?: "read" | "write" };
export type PlannedWrite = { method: string; args: unknown[] };

async function objectRef(ctx: TenantContext, ref: unknown) {
  if (typeof ref !== "string" || UUID.test(ref)) return ref;
  const o = await objectsService.get(ctx, ref);
  if (!o)
    throw notFound(
      "functions.objectNotFound",
      "object not found: {ref} (slug or uuid expected)",
      { ref },
    );
  return o.id;
}

// Simulated result of a write in dry run (shape close to the real return).
function simulate(method: string, a: unknown[], n: number) {
  const id = `dry-run-${n}`;
  const arg = (a[0] ?? {}) as Record<string, unknown>;
  if (method === "upsert")
    return { record: { id, ...arg }, created: true, dryRun: true };
  if (method === "update") return { id: a[0], data: a[1], dryRun: true };
  if (method === "transact")
    return ((a[0] as unknown[]) ?? []).map((_, i) => ({
      id: `${id}.${i}`,
      dryRun: true,
    }));
  return { id: a[0] ?? id, dryRun: true };
}

export function hostBridge(
  ctx: TenantContext,
  f: { permissions?: unknown },
  writes?: PlannedWrite[],
): HostBridge | undefined {
  const perms = (f.permissions ?? {}) as Perms;
  if (!perms.records && !perms.events) return undefined;
  return async (method, a) => {
    if (method === "events.push" || method === "events.list") {
      const need = method === "events.push" ? "write" : "read";
      if (!perms.events || (need === "write" && perms.events !== "write"))
        throw appError(
          "functions.eventsDenied",
          '{method} denied: declare permissions.events "{need}" in the function',
          { method, need },
        );
      if (method === "events.list")
        return eventsService.list(ctx, eventFilter(a[0]));
      if (writes) {
        writes.push({ method, args: a });
        return { dryRun: true };
      }
      const input = (a[0] ?? {}) as Omit<EventInput, "occurredAt"> & {
        occurredAt?: string;
      };
      return eventsService.insert(ctx, {
        ...input,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        source: input.source ?? "function",
        backfill: false,
      });
    }
    if (!READ.includes(method) && !WRITE.includes(method))
      throw appError(
        "functions.unknownMethod",
        "records.{method} unknown: available methods {methods}",
        { method, methods: [...READ, ...WRITE].join(", ") },
      );
    if (!perms.records)
      throw appError(
        "functions.recordsDenied",
        'records.{method} denied: declare permissions.records "{need}" in the function',
        { method, need: READ.includes(method) ? "read" : "write" },
      );
    if (WRITE.includes(method) && perms.records !== "write")
      throw appError(
        "functions.recordsWriteDenied",
        'records.{method} denied: permissions.records "write" required (current: "read")',
        { method },
      );
    // SDK RPC input: malformed record id = not found,
    // before any query (no SQL error returned to the function code).
    if (["get", "update", "delete", "merge"].includes(method) && !isUuid(a[0]))
      throw notFound("records.notFound", "Record not found");
    if (method === "search") a = [await objectRef(ctx, a[0]), ...a.slice(1)];
    if (method === "upsert" && a[0] && typeof a[0] === "object") {
      const u = a[0] as { objectId?: unknown };
      a = [{ ...u, objectId: await objectRef(ctx, u.objectId) }];
    }
    if (writes && WRITE.includes(method)) {
      writes.push({ method, args: a });
      return simulate(method, a, writes.length);
    }
    if (method === "get") return recordsService.get(ctx, String(a[0]));
    if (method === "search")
      return recordsService.search(ctx, String(a[0]), (a[1] ?? {}) as never);
    if (method === "delete") {
      const row = await recordsService.remove(ctx, String(a[0]));
      if (!row)
        throw notFound(
          "functions.recordNotFound",
          "records.delete: record not found: {id}",
          { id: String(a[0]) },
        );
      return { id: row.id, deleted: true };
    }
    if (method === "merge")
      return recordsService.merge(ctx, String(a[0]), (a[1] ?? []) as string[]);
    const r = recordsService as unknown as Record<
      string,
      (ctx: TenantContext, ...a: unknown[]) => Promise<unknown>
    >;
    return r[method]!(ctx, ...a);
  };
}

// Runs the function and logs its output (function_logs), success or failure.
// Error rethrown without secrets; its logs stay in function_logs.
export async function runLogged(
  ctx: TenantContext,
  f: FunctionRow,
  input: unknown,
  opts: {
    source: "workflow" | "page" | "test";
    secrets: Record<string, string>;
    run?: { runId: string; path: string; stepId?: string };
    writes?: PlannedWrite[];
    // Run step signal: abort = execution killed.
    signal?: AbortSignal;
  },
) {
  const started = Date.now();
  let logs = "";
  let error: string | null = null;
  try {
    const r = await execFunction(f as SandboxFunction, input, {
      secrets: opts.secrets,
      host: hostBridge(ctx, f, opts.writes),
      test: ctx.test,
      signal: opts.signal,
    });
    logs = r.logs;
    return JSON.parse(redact(JSON.stringify(r), opts.secrets)) as typeof r;
  } catch (e) {
    if (e instanceof FunctionError) logs = e.logs;
    error = redact((e as Error).message, opts.secrets);
    // Outside workflows (the engine already records its failures): error center.
    if (opts.source === "page")
      await recordError(ctx, {
        source: "function",
        request: f.name,
        message: error,
        payload: { input, version: f.version },
      }).catch(() => {});
    // Code kept (functions.invalidInput…) for translation on the web side.
    throw new FunctionError(
      error,
      redact(logs, opts.secrets),
      e instanceof AppError
        ? { code: e.code, params: e.params }
        : { code: "functions.failed" },
    );
  } finally {
    await withTenant(ctx, (tx) =>
      tx.insert(functionLogs).values({
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        functionName: f.name,
        version: f.version,
        source: opts.source,
        runId: opts.run?.runId ?? null,
        path: opts.run?.path ?? null,
        stepId: opts.run?.stepId ?? null,
        logs: redact(logs, opts.secrets),
        error,
        durationMs: Date.now() - started,
      }),
    ).catch(() => {});
  }
}

// events.list filter received as JSON (dates as ISO strings).
const eventFilter = (v: unknown) => {
  const f = (v ?? {}) as Record<string, unknown>;
  const date = (d: unknown) =>
    typeof d === "string" ? new Date(d) : undefined;
  return { ...f, from: date(f.from), to: date(f.to) } as EventFilter;
};

const unknownFunction = (name: string, version?: number) =>
  version
    ? notFound(
        "functions.versionNotFound",
        "Function {name} version {version} not found. See functions.versions.",
        { name, version },
      )
    : notFound(
        "functions.notFound",
        "Function {name} not found. See functions.list.",
        { name },
      );

export const functionsService = {
  // Latest version of each workspace function.
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select()
        .from(functions)
        .where(eq(functions.workspaceId, ctx.workspaceId))
        .orderBy(functions.name, desc(functions.version)),
    );
    return rows.filter((r, i) => rows[i - 1]?.name !== r.name);
  },
  // Without version: the latest.
  get: async (ctx: TenantContext, name: string, version?: number) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) => find(tx, ctx, name, version));
  },
  versions: async (ctx: TenantContext, name: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select()
        .from(functions)
        .where(byName(ctx, name))
        .orderBy(functions.version),
    );
  },
  // Creates the function or, if the name exists, a new version.
  save: async (ctx: TenantContext, input: FunctionInput) => {
    await requireScope(ctx, "admin");
    assertDomains(input.permissions?.domains);
    const f = functionInputSchema.parse(input);
    return withTenant(ctx, async (tx) => {
      const row = await insert(tx, ctx, f);
      await audit(
        tx,
        ctx,
        "function.save",
        { type: "function", id: row.id },
        f,
      );
      return row;
    });
  },
  // Like save, but refused if the name already exists.
  create: async (ctx: TenantContext, input: FunctionInput) => {
    await requireScope(ctx, "admin");
    assertDomains(input.permissions?.domains);
    const { name } = functionInputSchema.parse(input);
    if (await withTenant(ctx, (tx) => find(tx, ctx, name)))
      throw appError(
        "functions.alreadyExists",
        "Function {name} already exists. Use functions.update for a new version.",
        { name },
        { kind: "conflict" },
      );
    return functionsService.save(ctx, input);
  },
  // Like save, but refused if the name does not exist: new version.
  update: async (ctx: TenantContext, input: FunctionInput) => {
    await requireScope(ctx, "admin");
    assertDomains(input.permissions?.domains);
    const { name } = functionInputSchema.parse(input);
    if (!(await withTenant(ctx, (tx) => find(tx, ctx, name))))
      throw unknownFunction(name);
    return functionsService.save(ctx, input);
  },
  // Deletes the function and all its versions.
  remove: async (ctx: TenantContext, name: string) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      const rows = await tx
        .delete(functions)
        .where(byName(ctx, name))
        .returning({ id: functions.id });
      if (rows.length)
        await audit(tx, ctx, "function.delete", { type: "function", id: name });
      return rows.length > 0;
    });
  },
  // Isolated execution (without workflow), with logs. Without version: the latest.
  // dryRun: real reads, writes (records, events) simulated and
  // returned in `writes`; the network, however, is not simulated.
  test: async (
    ctx: TenantContext,
    name: string,
    input: unknown,
    version?: number,
    opts: { dryRun?: boolean } = {},
  ) => {
    await requireScope(ctx, "admin");
    const f = await withTenant(ctx, (tx) => find(tx, ctx, name, version));
    if (!f) throw unknownFunction(name, version);
    const writes = opts.dryRun ? ([] as PlannedWrite[]) : undefined;
    const r = await runLogged(ctx, f, input, {
      source: "test",
      secrets: await decryptAll(ctx),
      writes,
    });
    return writes ? { ...r, writes } : r;
  },
  // Call from a page: latest version, output only.
  call: async (ctx: TenantContext, name: string, input: unknown) => {
    await requireScope(ctx, "write");
    const f = await withTenant(ctx, (tx) => find(tx, ctx, name));
    if (!f) throw unknownFunction(name);
    const r = await runLogged(ctx, f, input, {
      source: "page",
      secrets: await decryptAll(ctx),
    });
    return r.output;
  },
  // Execution logs (workflow, page, test), most recent first,
  // cursor-paginated. Filters: function, run, source.
  logs: async (
    ctx: TenantContext,
    f: {
      name?: string;
      runId?: string;
      source?: "workflow" | "page" | "test";
      errorsOnly?: boolean;
      cursor?: string;
      limit?: number;
    } = {},
  ) => {
    await requireScope(ctx, "read");
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select()
        .from(functionLogs)
        .where(
          and(
            eq(functionLogs.workspaceId, ctx.workspaceId),
            f.name ? eq(functionLogs.functionName, f.name) : undefined,
            f.runId ? eq(functionLogs.runId, f.runId) : undefined,
            f.source ? eq(functionLogs.source, f.source) : undefined,
            f.errorsOnly ? sql`${functionLogs.error} is not null` : undefined,
            f.cursor && UUID.test(f.cursor)
              ? sql`(${functionLogs.createdAt}, ${functionLogs.id}) < (select created_at, id from function_logs where id = ${f.cursor})`
              : undefined,
          ),
        )
        .orderBy(desc(functionLogs.createdAt), desc(functionLogs.id))
        .limit(limit + 1),
    );
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      items,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  },
  // Restore = new version taking the content of `version`.
  restore: async (ctx: TenantContext, name: string, version: number) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      const old = await find(tx, ctx, name, version);
      if (!old) return null;
      const row = await insert(tx, ctx, {
        name,
        code: old.code,
        inputSchema: old.inputSchema as Record<string, unknown>,
        outputSchema: old.outputSchema as Record<string, unknown>,
        permissions: old.permissions as {
          domains: string[];
          secrets: string[];
          records?: "read" | "write";
          events?: "read" | "write";
        },
        limits: old.limits as { timeoutMs?: number; memoryMb?: number },
      });
      await audit(
        tx,
        ctx,
        "function.restore",
        { type: "function", id: row.id },
        {
          name,
          version,
        },
      );
      return row;
    });
  },
};
export {
  FunctionError,
  LIMITS,
  execFunction,
  runFunction,
  type HostBridge,
  type SandboxFunction,
} from "./sandbox";
