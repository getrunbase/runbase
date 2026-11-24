// Trash and history operations of recordsService: list, restore and
// purge deleted records, read the audit history, revert a modification.
import { and, desc, eq, sql } from "drizzle-orm";
import { appError, notFound } from "../errors/app-error";
import { anyUuid } from "../db/any";
import { requireScope } from "../api-keys";
import { audit, auditService } from "../audit";
import { auditLog, deletedRecords, events, records } from "../db/schema";
import { fieldsSchema } from "../objects/fields";
import { checkRecordQuota } from "../quotas";
import { withTenant, type TenantContext } from "../tenant";
import { objectsOf, page, syncKeys } from "./helpers";
import { TRASH_DAYS, type Data } from "./types";
import { publishUpsert, updateInTx } from "./write";

export const trashOps = {
  // Trash of an object: deleted records, most recent first, with their
  // automatic purge date.
  trash: async (
    ctx: TenantContext,
    objectId: string,
    // `after`: id of the last element of the previous page (keyset).
    p: { limit?: number; after?: string } = {},
  ) => {
    await requireScope(ctx, "read");
    const { limit } = page(p);
    const at = sql`(select deleted_at from deleted_records where id = ${p.after ?? null})`;
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select()
        .from(deletedRecords)
        .where(
          and(
            eq(deletedRecords.objectId, objectId),
            eq(deletedRecords.workspaceId, ctx.workspaceId),
            p.after
              ? sql`(${deletedRecords.deletedAt}, ${deletedRecords.id}) < (${at}, ${p.after}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(deletedRecords.deletedAt), desc(deletedRecords.id))
        .limit(limit),
    );
    return rows.map((r) => ({
      id: r.id,
      objectId: r.objectId,
      externalId: r.externalId,
      data: r.data,
      createdAt: r.createdAt,
      deletedAt: r.deletedAt,
      purgeAt: new Date(r.deletedAt.getTime() + TRASH_DAYS * 86_400_000),
    }));
  },

  // Restore from the trash: same id, same values, timeline
  // recovered; the ref/refs removed at deletion are put back if the
  // field stayed empty (ref) or if it is a list (refs). Fails if
  // a unique value or the external_id was taken in the meantime.
  restore: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "write");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .delete(deletedRecords)
        .where(
          and(
            eq(deletedRecords.id, id),
            eq(deletedRecords.workspaceId, ctx.workspaceId),
          ),
        )
        .returning();
      if (!row)
        throw notFound("records.notInTrash", "Record not found in trash");
      await checkRecordQuota(tx, ctx);
      const [record] = await tx
        .insert(records)
        .values({
          id: row.id,
          organizationId: row.organizationId,
          workspaceId: row.workspaceId,
          objectId: row.objectId,
          externalId: row.externalId,
          data: row.data,
          createdAt: row.createdAt,
        })
        .onConflictDoNothing()
        .returning();
      if (!record)
        throw appError(
          "records.restoreExternalIdTaken",
          "Cannot restore: external_id “{externalId}” already in use",
          { externalId: String(row.externalId) },
        );
      const object = (await objectsOf(tx, ctx)).find(
        (o) => o.id === row.objectId,
      );
      if (!object) throw notFound("objects.notFound", "Object not found");
      await syncKeys(
        tx,
        ctx,
        object.id,
        fieldsSchema.parse(object.fields),
        id,
        record.data,
      );
      for (const l of row.links) {
        const cur = sql`${records.data}->${l.key}`;
        await tx
          .update(records)
          .set({
            data: sql`jsonb_set(${records.data}, array[${l.key}], case when jsonb_typeof(${cur}) = 'array' then ${cur} || to_jsonb(${id}::text) else to_jsonb(${id}::text) end)`,
          })
          .where(
            and(
              eq(records.id, l.id),
              eq(records.workspaceId, ctx.workspaceId),
              sql`(jsonb_typeof(${cur}) = 'array' and not ${cur} ? ${id}) or coalesce(jsonb_typeof(${cur}), 'null') = 'null'`,
            ),
          );
      }
      await audit(tx, ctx, "record.restore", { type: "record", id }, {});
      return record;
    });
  },

  // Empties the trash (everything, one object, or ids) without waiting for the automatic
  // purge. Permanent; events remain, without a link to the record.
  purge: async (
    ctx: TenantContext,
    opts: { objectId?: string; ids?: string[] } = {},
  ) => {
    await requireScope(ctx, "write");
    return withTenant(ctx, async (tx) => {
      const gone = await tx
        .delete(deletedRecords)
        .where(
          and(
            eq(deletedRecords.workspaceId, ctx.workspaceId),
            opts.objectId
              ? eq(deletedRecords.objectId, opts.objectId)
              : undefined,
            opts.ids ? anyUuid(deletedRecords.id, opts.ids) : undefined,
          ),
        )
        .returning({ id: deletedRecords.id });
      const ids = gone.map((g) => g.id);
      if (ids.length) {
        await tx
          .update(events)
          .set({ recordId: null })
          .where(
            and(
              eq(events.workspaceId, ctx.workspaceId),
              anyUuid(events.recordId, ids),
            ),
          );
        await audit(
          tx,
          ctx,
          "record.purge",
          { type: "object", id: opts.objectId ?? ctx.workspaceId },
          { ids },
        );
      }
      return { purged: ids.length };
    });
  },

  // History of a record (audit, most recent first): creation,
  // modifications with before/after values, deletion, restoration.
  history: (ctx: TenantContext, id: string) =>
    auditService.history(ctx, { type: "record", id }),

  // Restores the values from before a modification (record.update entry of
  // records.history): a new modification, traced like the others.
  revert: async (ctx: TenantContext, id: string, auditId: string) => {
    await requireScope(ctx, "write");
    const result = await withTenant(ctx, async (tx) => {
      const [entry] = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.id, auditId),
            eq(auditLog.workspaceId, ctx.workspaceId),
            eq(auditLog.resourceType, "record"),
            eq(auditLog.resourceId, id),
          ),
        );
      const diff = entry?.diff as { changed?: string[]; before?: Data } | null;
      if (entry?.action !== "record.update" || !diff?.before)
        throw notFound(
          "records.versionNotFound",
          "Version not found: only an update recorded with its previous values can be reverted",
        );
      const before = diff.before;
      return updateInTx(
        tx,
        ctx,
        id,
        Object.fromEntries(
          (diff.changed ?? Object.keys(before)).map((k) => [
            k,
            before[k] ?? null,
          ]),
        ),
      );
    });
    await publishUpsert(ctx, {}, result);
    return result;
  },
};
