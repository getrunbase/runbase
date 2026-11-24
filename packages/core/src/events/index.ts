// Events: insertion and chronological timeline of a record.
import { appError, notFound } from "../errors/app-error";
import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  lte,
  notLike,
  sql,
} from "drizzle-orm";
import { requireScope } from "../api-keys";
import { publish } from "../bus";
import { events, records } from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import { isUuid } from "../lib/uuid";

export type EventInput = {
  recordId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
  source?: string | null;
  // External id (Stripe evt_…, replay): a second push with the same key returns
  // the existing event (`duplicate`) without republishing anything.
  idempotencyKey?: string | null;
  // Backfill: written without publishing anything on the bus.
  backfill?: boolean;
  // Chain depth (event.emit from a run), propagated to the bus.
  depth?: number;
  // Test event: deleted by workspace.purge_test.
  test?: boolean;
};

// Insertion in a provided transaction (`write` scope checked by the caller).
export async function insertInTx(
  tx: Tx,
  ctx: TenantContext,
  input: EventInput,
) {
  if (input.recordId) {
    if (!isUuid(input.recordId))
      throw notFound("records.notFound", "Record not found");
    const [rec] = await tx
      .select({ id: records.id })
      .from(records)
      .where(
        and(
          eq(records.id, input.recordId),
          eq(records.workspaceId, ctx.workspaceId),
        ),
      );
    if (!rec) throw notFound("records.notFound", "Record not found");
  }
  const [event] = await tx
    .insert(events)
    .values({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      recordId: input.recordId ?? null,
      type: input.type,
      payload: input.payload ?? {},
      occurredAt: input.occurredAt,
      source: input.source ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      isTest: input.test ?? ctx.test ?? false,
    })
    .onConflictDoNothing()
    .returning();
  if (event) return { ...event, duplicate: false };
  const [seen] = await tx
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspaceId, ctx.workspaceId),
        eq(events.idempotencyKey, input.idempotencyKey ?? ""),
      ),
    );
  if (!seen)
    throw appError("events.insertFailed", "Could not insert the event");
  return { ...seen, duplicate: true };
}

// Publication on the bus, to call after commit.
export async function publishEvent(
  ctx: TenantContext,
  input: Pick<EventInput, "backfill" | "depth">,
  event: { id: string; duplicate?: boolean },
) {
  if (!input.backfill && !event.duplicate)
    await publish("event.received", {
      ...ctx,
      id: event.id,
      ...(input.depth && { depth: input.depth }),
    });
}

// Malformed cursor = first page, no SQL error.

export type EventFilter = {
  type?: string;
  recordId?: string;
  // Occurred from / until.
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
};

export const eventsService = {
  insert: async (ctx: TenantContext, input: EventInput) => {
    await requireScope(ctx, "write");
    const event = await withTenant(ctx, (tx) => insertInTx(tx, ctx, input));
    await publishEvent(ctx, input, event);
    return event;
  },

  timeline: async (ctx: TenantContext, recordId: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select()
        .from(events)
        .where(
          and(
            eq(events.recordId, recordId),
            eq(events.workspaceId, ctx.workspaceId),
          ),
        )
        .orderBy(asc(events.occurredAt), asc(events.createdAt)),
    );
  },

  // Filtered workspace events (type, record, dates), from newest to
  // oldest, paginated: `cursor` = received `nextCursor`.
  list: async (ctx: TenantContext, filter: EventFilter = {}) => {
    await requireScope(ctx, "read");
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const found = await withTenant(ctx, (tx) =>
      tx
        .select()
        .from(events)
        .where(
          and(
            eq(events.workspaceId, ctx.workspaceId),
            filter.type ? eq(events.type, filter.type) : undefined,
            filter.recordId ? eq(events.recordId, filter.recordId) : undefined,
            filter.from ? gte(events.occurredAt, filter.from) : undefined,
            filter.to ? lte(events.occurredAt, filter.to) : undefined,
            filter.cursor && isUuid(filter.cursor)
              ? sql`(${events.occurredAt}, ${events.id}) < (select occurred_at, id from events where id = ${filter.cursor})`
              : undefined,
          ),
        )
        .orderBy(desc(events.occurredAt), desc(events.id))
        .limit(limit + 1),
    );
    const items = found.slice(0, limit);
    return {
      items,
      hasMore: found.length > limit,
      nextCursor: found.length > limit ? items[items.length - 1]!.id : null,
    };
  },

  // Event types already received (choice list of the "Event" trigger).
  types: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const rows = await withTenant(ctx, (tx) =>
      tx
        .selectDistinct({ type: events.type })
        .from(events)
        // record.*: internal timeline, never published (trigger.event would
        // not receive them); the "Record" triggers cover them.
        .where(
          and(
            eq(events.workspaceId, ctx.workspaceId),
            notLike(events.type, "record.%"),
          ),
        )
        .orderBy(events.type)
        .limit(200),
    );
    return rows.map((r) => r.type);
  },

  // Funnel: distinct records that received each event type, in the given order.
  funnel: async (ctx: TenantContext, types: string[]) => {
    await requireScope(ctx, "read");
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select({ type: events.type, count: countDistinct(events.recordId) })
        .from(events)
        .where(
          and(
            eq(events.workspaceId, ctx.workspaceId),
            inArray(events.type, types),
          ),
        )
        .groupBy(events.type),
    );
    const by = new Map(rows.map((r) => [r.type, Number(r.count)]));
    return types.map((type) => ({ type, count: by.get(type) ?? 0 }));
  },
};
