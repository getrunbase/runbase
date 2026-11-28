// Transactional record writes (upsert, update, delete), bus publication
// and the trash purge.
import { and, eq, lt, sql } from "drizzle-orm";
import { appError, notFound } from "../errors/app-error";
import { anyUuid } from "../db/any";
import { audit } from "../audit";
import { publish } from "../bus";
import { db } from "../db/client";
import {
  deletedRecords,
  events,
  objects,
  recordKeys,
  records,
} from "../db/schema";
import {
  coerceValues,
  fieldsSchema,
  recordValidator,
  uniqueValue,
} from "../objects/fields";
import { checkRecordQuota } from "../quotas";
import type { TenantContext, Tx } from "../tenant";
import { isUuid } from "../lib/uuid";
import {
  changedFields,
  checkKnownFields,
  checkRefs,
  lowerEmails,
  objectsOf,
  pick,
  prepareNew,
  recompute,
  syncKeys,
  timelineEvent,
  updateDiff,
  validateMerge,
} from "./helpers";
import {
  TRASH_DAYS,
  type Data,
  type ObjectRow,
  type UpsertInput,
} from "./types";

// Upsert in a provided transaction (`write` scope checked by the caller):
// lets ingestion write the record and event in the same transaction.
export async function upsertInTx(tx: Tx, ctx: TenantContext, raw: UpsertInput) {
  const object = (await objectsOf(tx, ctx)).find((o) => o.id === raw.objectId);
  if (!object) throw notFound("objects.notFound", "Object not found");
  const objectFields = fieldsSchema.parse(object.fields);
  const validate = recordValidator(objectFields);
  checkKnownFields(objectFields, raw.data);
  const input = {
    ...raw,
    data: lowerEmails(objectFields, coerceValues(objectFields, raw.data)),
  };

  // Atomic upsert (unique index object_id, external_id): we try
  // the insert, ON CONFLICT DO NOTHING waits for the commit of a concurrent
  // insert. Otherwise the row exists: locked then merged.
  // An insert that is invalid on its own (partial merge) falls back to the update.
  const fresh = await prepareNew(tx, ctx, object.id, objectFields, input.data);
  const insertable = validate.safeParse(fresh);
  let record: typeof records.$inferSelect | undefined;
  let existing: typeof records.$inferSelect | undefined;
  // Upsert by unique field: transactional lock on (object, field, value)
  // then key read. Two concurrent upserts of the same value are
  // serialized instead of creating a duplicate.
  if (input.match && !input.externalId) {
    const f = objectFields.find((x) => x.key === input.match && x.unique);
    if (!f)
      throw appError(
        "records.matchUniqueRequired",
        "match: unique field required ({field})",
        { field: input.match },
      );
    const value = uniqueValue(f, input.data[f.key]);
    if (value === null)
      throw appError(
        "records.matchValueRequired",
        "match: value required ({field})",
        { field: f.key },
      );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${object.id}:${f.key}:${value}`}, 0))`,
    );
    const [key] = await tx
      .select({ id: recordKeys.recordId })
      .from(recordKeys)
      .where(
        and(
          eq(recordKeys.objectId, object.id),
          eq(recordKeys.field, f.key),
          eq(recordKeys.value, value),
        ),
      );
    if (key)
      [existing] = await tx
        .select()
        .from(records)
        .where(eq(records.id, key.id))
        .for("update");
  }
  if (insertable.success && !existing)
    await checkRefs(tx, ctx, objectFields, fresh);
  if (!existing && (insertable.success || !input.externalId)) {
    await checkRecordQuota(tx, ctx);
    [record] = await tx
      .insert(records)
      .values({
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        objectId: object.id,
        externalId: input.externalId ?? null,
        data: validate.parse(fresh) as Data,
        isTest: input.test ?? ctx.test ?? false,
      })
      .onConflictDoNothing({
        target: [records.objectId, records.externalId],
      })
      .returning();
  }
  if (!existing && !record && input.externalId)
    [existing] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.objectId, object.id),
          eq(records.externalId, input.externalId),
        ),
      )
      .for("update");
  // Neither insert nor existing row: invalid data, report the error.
  if (!record && !existing) {
    validate.parse(fresh);
    throw appError("records.upsertFailed", "Upsert failed");
  }

  let changed: string[];
  // A test record adopted as live by this write (see below).
  let promoted = false;
  if (existing) {
    const before = existing.data;
    const data = recompute(
      objectFields,
      before,
      input.mode !== "replace"
        ? validateMerge(
            validate,
            { ...before, ...input.data },
            Object.keys(input.data),
          )
        : (validate.parse(input.data) as Data),
    );
    changed = changedFields(before, data);
    await checkRefs(tx, ctx, objectFields, pick(data, changed));
    // A live (non-test) write adopts a test record: it is live data now and
    // workspace.purge_test must not delete it.
    const promote = existing.isTest && !(input.test ?? ctx.test ?? false);
    if (!changed.length && !promote)
      return { record: existing, created: false, changed, promoted: false };
    promoted = promote;
    [record] = await tx
      .update(records)
      .set({ data, updatedAt: new Date(), ...(promote && { isTest: false }) })
      .where(eq(records.id, existing.id))
      .returning();
  } else changed = changedFields({}, record!.data);
  if (
    objectFields.some((f) => f.unique && (!existing || changed.includes(f.key)))
  )
    await syncKeys(tx, ctx, object.id, objectFields, record!.id, record!.data);
  await audit(
    tx,
    ctx,
    existing ? "record.update" : "record.create",
    { type: "record", id: record!.id },
    existing ? updateDiff(existing.data, record!.data, changed) : { changed },
  );
  if (!input.backfill)
    await timelineEvent(
      tx,
      ctx,
      record!.id,
      existing ? "record.updated" : "record.created",
      existing?.data ?? {},
      record!.data,
      changed,
      input.test || record!.isTest,
    );
  return { record: record!, created: !existing, changed, promoted };
}

export async function updateInTx(
  tx: Tx,
  ctx: TenantContext,
  id: string,
  data: Data,
  mode: "merge" | "replace" = "merge",
  // test: true keeps a test record purgeable (no promotion to live).
  opts: { test?: boolean } = {},
) {
  if (!isUuid(id)) throw notFound("records.notFound", "Record not found");
  const [row] = await tx
    .select({ record: records, object: objects })
    .from(records)
    .innerJoin(objects, eq(objects.id, records.objectId))
    .where(and(eq(records.id, id), eq(records.workspaceId, ctx.workspaceId)))
    .for("update", { of: records });
  if (!row) throw notFound("records.notFound", "Record not found");
  const fields = fieldsSchema.parse(row.object.fields);
  const validate = recordValidator(fields);
  const before = row.record.data;
  checkKnownFields(fields, data);
  const input = lowerEmails(fields, coerceValues(fields, data));
  const next = recompute(
    fields,
    before,
    mode === "replace"
      ? (validate.parse(input) as Data)
      : validateMerge(validate, { ...before, ...input }, Object.keys(input)),
  );
  const changed = changedFields(before, next);
  await checkRefs(tx, ctx, fields, pick(next, changed));
  // Live write on a test record: promote it (see upsertInTx).
  const promote = row.record.isTest && !(opts.test ?? ctx.test ?? false);
  if (!changed.length && !promote)
    return { record: row.record, created: false, changed, promoted: false };
  const [record] = await tx
    .update(records)
    .set({
      data: next,
      updatedAt: new Date(),
      ...(promote && { isTest: false }),
    })
    .where(eq(records.id, id))
    .returning();
  if (fields.some((f) => f.unique && changed.includes(f.key)))
    await syncKeys(tx, ctx, row.object.id, fields, id, next);
  await audit(
    tx,
    ctx,
    "record.update",
    { type: "record", id },
    updateDiff(before, next, changed),
  );
  await timelineEvent(
    tx,
    ctx,
    id,
    "record.updated",
    before,
    next,
    changed,
    record!.isTest,
  );
  return { record: record!, created: false, changed, promoted: promote };
}

// Warning returned when a live write adopted a test record.
export const PROMOTED_WARNING =
  "test record adopted as live; pass test:true to keep it purgeable";

// Adds `warning` to a write result whose test record was promoted.
export function withPromotion<T extends { promoted: boolean }>(r: T) {
  return r.promoted ? { ...r, warning: PROMOTED_WARNING } : r;
}

// References (ref/refs) of workspace records to `ids` (records of
// `target`): replaced by `to`, or removed if `to` is null (ref -> null,
// element removed from a refs). Returns the touched links (record, field).
export async function rewriteRefs(
  tx: Tx,
  ctx: TenantContext,
  target: ObjectRow,
  ids: string[],
  to: string | null,
) {
  const list = sql`array[${sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  )}]::text[]`;
  const links: { id: string; key: string }[] = [];
  for (const o of await objectsOf(tx, ctx))
    for (const f of fieldsSchema.parse(o.fields)) {
      if (f.type !== "ref" && f.type !== "refs") continue;
      if (f.object !== target.slug && f.object !== target.id) continue;
      const value =
        f.type === "ref"
          ? to
            ? sql`to_jsonb(${to}::text)`
            : sql`'null'::jsonb`
          : sql`(select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from (select case when x = any(${list}) then ${to}::text else x end e from jsonb_array_elements_text(${records.data}->${f.key}) x) s where e is not null)`;
      const hit =
        f.type === "ref"
          ? sql`(${records.data}->>${f.key}) = any(${list})`
          : sql`jsonb_typeof(${records.data}->${f.key}) = 'array' and ${records.data}->${f.key} ?| ${list}`;
      const rows = await tx
        .update(records)
        .set({
          data: sql`jsonb_set(${records.data}, array[${f.key}], ${value})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(records.workspaceId, ctx.workspaceId),
            eq(records.objectId, o.id),
            hit,
          ),
        )
        .returning({ id: records.id });
      links.push(...rows.map((r) => ({ id: r.id, key: f.key })));
    }
  return links;
}

// Deletion = move to trash (deleted_records): the record leaves
// `records`, hence all reads, searches and SQL views. The ref/refs
// pointing to it are removed and noted for restoration. The timeline
// (events) is kept.
export async function removeInTx(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .delete(records)
    .where(and(eq(records.id, id), eq(records.workspaceId, ctx.workspaceId)))
    .returning();
  if (!row) return null;
  const object = (await objectsOf(tx, ctx)).find((o) => o.id === row.objectId)!;
  const links = await rewriteRefs(tx, ctx, object, [id], null);
  await tx.insert(deletedRecords).values({ ...row, links });
  await audit(tx, ctx, "record.delete", { type: "record", id }, row);
  return row;
}

// Publication on the bus, to call after commit; no job if nothing changed.
export async function publishUpsert(
  ctx: TenantContext,
  input: Pick<UpsertInput, "backfill">,
  result: Awaited<ReturnType<typeof upsertInTx>>,
) {
  if (!input.backfill && (result.changed.length || result.created))
    await publish(result.created ? "record.created" : "record.updated", {
      ...ctx,
      id: result.record.id,
      objectId: result.record.objectId,
      changed: result.changed,
    });
}

// Purge of records in the trash for more than `days` days, all workspaces
// (worker system task, outside tenant context). Their events remain, without
// a link to the record.
export async function purgeExpiredRecords(days = TRASH_DAYS) {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return db.transaction(async (tx) => {
    const gone = await tx
      .delete(deletedRecords)
      .where(lt(deletedRecords.deletedAt, cutoff))
      .returning({ id: deletedRecords.id });
    if (gone.length)
      await tx
        .update(events)
        .set({ recordId: null })
        .where(
          anyUuid(
            events.recordId,
            gone.map((g) => g.id),
          ),
        );
    return gone.length;
  });
}
