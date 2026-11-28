// Workspace error center: filterable list, replay, resolution.
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import { requireScope } from "../api-keys";
import { errors, workflowRuns } from "../db/schema";
import { replayIngest } from "../ingest";
import { retryRun } from "../runs";
import { retryTrigger } from "../triggers";
import { withTenant, type TenantContext } from "../tenant";
import { isUuid } from "../lib/uuid";
import { cleanError, fingerprint, truncateStack } from "./clean";
import { appError } from "./app-error";

export { recordError } from "./record";
export { cleanStack } from "./clean";
export {
  AppError,
  appError,
  authStatus,
  errorItem,
  forbidden,
  notFound,
  renderTemplate,
  requireConfirm,
  toErrorItem,
  unauthorized,
  type ErrorInfo,
  type ErrorItem,
  type ErrorKind,
  type ErrorParams,
} from "./app-error";
export type ErrorRow = typeof errors.$inferSelect;
type Filter = {
  source?: ErrorRow["source"];
  // Sources left out when `source` is not given (MCP: agent tool errors).
  excludeSources?: ErrorRow["source"][];
  status?: ErrorRow["status"];
  // Errors of a workflow's runs, of a record, or of a run.
  workflowId?: string;
  recordId?: string;
  runId?: string;
  from?: Date;
  to?: Date;
  // One row per fingerprint: the most recent, with `count` and
  // `lastAt` (occurrences matching the source and status filters).
  group?: boolean;
  // `nextCursor` of the previous page.
  cursor?: string;
  limit?: number;
};

const byId = (ctx: TenantContext, id: string) =>
  and(eq(errors.id, id), eq(errors.workspaceId, ctx.workspaceId));

const setStatus = (
  ctx: TenantContext,
  id: string,
  status: ErrorRow["status"],
) =>
  withTenant(ctx, (tx) =>
    tx.update(errors).set({ status }).where(byId(ctx, id)).returning(),
  );

// The same component error (page, block, message) is recorded
// only once while it stays open (no flooding by clients).
async function reportComponent(
  ctx: TenantContext,
  e: { page: string; block: string; message: string; stack?: string },
) {
  await requireScope(ctx, "read");
  const message = cleanError(e.message).slice(0, 500);
  const request = `page/${e.page}/${e.block}`.slice(0, 200);
  return withTenant(ctx, async (tx) => {
    const [open] = await tx
      .select({ id: errors.id })
      .from(errors)
      .where(
        and(
          eq(errors.workspaceId, ctx.workspaceId),
          eq(errors.source, "component"),
          eq(errors.status, "open"),
          eq(errors.request, request),
          eq(errors.message, message),
        ),
      )
      .limit(1);
    if (open) return { id: open.id, duplicate: true };
    const [row] = await tx
      .insert(errors)
      .values({
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        source: "component",
        request,
        message,
        payload: { page: e.page, block: e.block },
        stack: e.stack ? truncateStack(e.stack) : undefined,
        fingerprint: fingerprint(message),
      })
      .returning({ id: errors.id });
    return { id: row!.id, duplicate: false };
  });
}

// Failed trigger fan-out (webhook mapping): event and workflow to replay.
function triggerRef(p: unknown) {
  const o = p as { eventId?: unknown; workflowId?: unknown } | null;
  return typeof o?.eventId === "string" && typeof o.workflowId === "string"
    ? { eventId: o.eventId, workflowId: o.workflowId }
    : null;
}

export const errorsService = {
  reportComponent,
  // Most recent first, cursor-paginated.
  list: async (ctx: TenantContext, f: Filter = {}) => {
    await requireScope(ctx, "read");
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const byRun = f.workflowId || f.recordId;
    return withTenant(ctx, async (tx) => {
      const q = tx.select({ e: errors }).from(errors);
      const found = await (
        byRun ? q.innerJoin(workflowRuns, eq(workflowRuns.id, errors.runId)) : q
      )
        .where(
          and(
            eq(errors.workspaceId, ctx.workspaceId),
            f.source && eq(errors.source, f.source),
            !f.source && f.excludeSources?.length
              ? notInArray(errors.source, f.excludeSources)
              : undefined,
            f.status && eq(errors.status, f.status),
            f.runId ? eq(errors.runId, f.runId) : undefined,
            f.workflowId
              ? eq(workflowRuns.workflowId, f.workflowId)
              : undefined,
            f.recordId ? eq(workflowRuns.recordId, f.recordId) : undefined,
            f.from && gte(errors.createdAt, f.from),
            f.to && lte(errors.createdAt, f.to),
            // Malformed cursor (URL edited by hand) = first page, no SQL error.
            f.cursor && isUuid(f.cursor)
              ? sql`(${errors.createdAt}, ${errors.id}) < (select created_at, id from errors where id = ${f.cursor})`
              : undefined,
            // Grouped: only the most recent of each fingerprint.
            f.group
              ? sql`not exists (select 1 from errors e2 where e2.workspace_id = ${errors.workspaceId} and e2.fingerprint = ${errors.fingerprint} and (e2.created_at, e2.id) > (${errors.createdAt}, ${errors.id})${f.source ? sql` and e2.source = ${f.source}` : sql``}${f.status ? sql` and e2.status = ${f.status}` : sql``})`
              : undefined,
          ),
        )
        .orderBy(desc(errors.createdAt), desc(errors.id))
        .limit(limit + 1);
      let items: (ErrorRow & { count?: number; lastAt?: Date })[] = found
        .slice(0, limit)
        .map((r) => r.e);
      const prints = [
        ...new Set(items.map((e) => e.fingerprint).filter(Boolean)),
      ] as string[];
      if (f.group && prints.length) {
        const counts = await tx
          .select({ fp: errors.fingerprint, n: count() })
          .from(errors)
          .where(
            and(
              eq(errors.workspaceId, ctx.workspaceId),
              inArray(errors.fingerprint, prints),
              f.source && eq(errors.source, f.source),
              f.status && eq(errors.status, f.status),
            ),
          )
          .groupBy(errors.fingerprint);
        const by = new Map(counts.map((c) => [c.fp, c.n]));
        items = items.map((e) => ({
          ...e,
          count: (e.fingerprint && by.get(e.fingerprint)) || 1,
          lastAt: e.createdAt,
        }));
      }
      return {
        items,
        hasMore: found.length > limit,
        nextCursor: found.length > limit ? items[items.length - 1]!.id : null,
      };
    });
  },
  get: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "read");
    const [row] = await withTenant(ctx, (tx) =>
      tx.select().from(errors).where(byId(ctx, id)),
    );
    return row ?? null;
  },
  openCount: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const [row] = await withTenant(ctx, (tx) =>
      tx
        .select({ n: count() })
        .from(errors)
        .where(
          and(
            eq(errors.workspaceId, ctx.workspaceId),
            eq(errors.status, "open"),
          ),
        ),
    );
    return row?.n ?? 0;
  },
  // Replays the ingestion (stored body) or the run (failed step). Successful
  // ingestion: error resolved. Run restarted: a new failure will create an error.
  retry: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "write");
    const e = await errorsService.get(ctx, id);
    if (!e) return null;
    let ok = false;
    let result: unknown = null;
    if (e.source === "ingest") {
      const res = await replayIngest(
        ctx,
        e.payload as Parameters<typeof replayIngest>[1],
      );
      ok = res.ok;
      result = { status: res.status, body: res.body };
    } else if (e.runId) ok = await retryRun(ctx, e.runId);
    else if (triggerRef(e.payload)) {
      const { eventId, workflowId } = triggerRef(e.payload)!;
      ok = await retryTrigger(ctx, eventId, workflowId);
    } else throw appError("errors.notRetryable", "Error cannot be retried");
    if (ok) await setStatus(ctx, id, "resolved");
    return { ok, result };
  },
  resolve: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "write");
    const [row] = await setStatus(ctx, id, "resolved");
    return row ?? null;
  },
};
