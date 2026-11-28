// Write operations of recordsService: upsert, update, delete, merge and
// multi-operation transactions.
import { and, asc, eq } from "drizzle-orm";
import { appError, notFound } from "../errors/app-error";
import { anyUuid } from "../db/any";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { publish } from "../bus";
import { events, objects, recordKeys, records } from "../db/schema";
import type { Field } from "../objects/fields";
import { withTenant, type TenantContext } from "../tenant";
import { objectsOf } from "./helpers";
import type { Data, RecordRow, TransactOp, UpsertInput } from "./types";
import {
  publishUpsert,
  removeInTx,
  rewriteRefs,
  updateInTx,
  upsertInTx,
  withPromotion,
} from "./write";

export const writeOps = {
  // Deletion of a record: audit, then record.deleted published after commit.
  remove: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "write");
    const row = await withTenant(ctx, (tx) => removeInTx(tx, ctx, id));
    if (row)
      await publish("record.deleted", {
        ...ctx,
        id,
        objectId: row.objectId,
      });
    return row;
  },

  // Update by id (merge or replace), validated against the object schema.
  update: async (
    ctx: TenantContext,
    id: string,
    data: Data,
    mode: "merge" | "replace" = "merge",
    opts: { test?: boolean } = {},
  ) => {
    await requireScope(ctx, "write");
    const result = await withTenant(ctx, (tx) =>
      updateInTx(tx, ctx, id, data, mode, opts),
    );
    await publishUpsert(ctx, {}, result);
    return withPromotion(result);
  },

  // Atomic merge (contacts, companies): `keep` absorbs `merge`. Its
  // values win, empty fields are filled from the merged records (in
  // order). The workspace ref/refs and the events pointing to the
  // merged records move to `keep`, then the merged records are deleted. All or
  // nothing. Refs rewritten in SQL: no timeline event or bus on the
  // referencing records (a record.merge audit traces the operation).
  merge: async (ctx: TenantContext, keepId: string, mergeIds: string[]) => {
    await requireScope(ctx, "write");
    const ids = [...new Set(mergeIds)].filter((i) => i !== keepId);
    if (!ids.length)
      throw appError(
        "records.mergeEmpty",
        "merge: at least one record to merge",
      );
    const out = await withTenant(ctx, async (tx) => {
      // Lock in a stable order (no deadlock between two merges).
      const rows = await tx
        .select()
        .from(records)
        .where(
          and(
            eq(records.workspaceId, ctx.workspaceId),
            anyUuid(records.id, [keepId, ...ids]),
          ),
        )
        .orderBy(asc(records.id))
        .for("update");
      const keep = rows.find((r) => r.id === keepId);
      if (!keep || rows.length !== ids.length + 1)
        throw notFound("records.notFound", "Record not found");
      if (rows.some((r) => r.objectId !== keep.objectId))
        throw appError(
          "records.mergeMixedObjects",
          "merge: records belong to different objects",
        );
      const all = await objectsOf(tx, ctx);
      const object = all.find((o) => o.id === keep.objectId)!;
      const empty = (v: unknown) =>
        v == null || v === "" || (Array.isArray(v) && !v.length);
      const data = { ...keep.data };
      for (const id of ids)
        for (const [k, v] of Object.entries(
          rows.find((r) => r.id === id)!.data,
        ))
          if (empty(data[k]) && !empty(v)) data[k] = v;
      // Frees the unique keys of the merged records before taking them over.
      await tx.delete(recordKeys).where(anyUuid(recordKeys.recordId, ids));
      // The result stays test data only when every merged row is test;
      // merging live data into a test record promotes it (warning returned).
      const allTest = rows.every((r) => r.isTest);
      const result = await updateInTx(tx, ctx, keepId, data, "replace", {
        test: allTest,
      });
      await rewriteRefs(tx, ctx, object, ids, keepId);
      await tx
        .update(events)
        .set({ recordId: keepId })
        .where(
          and(
            eq(events.workspaceId, ctx.workspaceId),
            anyUuid(events.recordId, ids),
          ),
        );
      await tx.delete(records).where(anyUuid(records.id, ids));
      await audit(
        tx,
        ctx,
        "record.merge",
        { type: "record", id: keepId },
        { merged: rows.filter((r) => r.id !== keepId) },
      );
      return result;
    });
    await publishUpsert(ctx, {}, out);
    for (const id of ids)
      await publish("record.deleted", {
        ...ctx,
        id,
        objectId: out.record.objectId,
      });
    return withPromotion({ ...out, merged: ids });
  },

  // Several writes (upsert, update, delete, across all objects) in
  // a single transaction: an error rolls everything back. Bus published after commit.
  transact: async (ctx: TenantContext, ops: TransactOp[]) => {
    await requireScope(ctx, "write");
    if (ops.length > 1000)
      throw appError("records.transactMax", "transact: 1000 operations max");
    const results = await withTenant(ctx, async (tx) => {
      const out: (
        Awaited<ReturnType<typeof upsertInTx>> | { deleted: RecordRow | null }
      )[] = [];
      // `$n` (exact string) = id of the record of the already executed op n, in
      // id and in data values (ref, or element of a refs array).
      const ref = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(ref);
        const m = typeof v === "string" && /^\$(\d+)$/.exec(v);
        if (!m) return v;
        const r = out[Number(m[1])];
        const id = r && ("deleted" in r ? r.deleted?.id : r.record.id);
        if (!id)
          throw appError(
            "records.transactBadRef",
            "transact: {ref} does not point to a previous op",
            { ref: String(v) },
          );
        return id;
      };
      // Only ref/refs fields are resolved: a "$0" text stays a text.
      const refKeys = async (op: TransactOp): Promise<Set<string>> => {
        let fields: unknown;
        if (op.op === "upsert")
          fields = (await objectsOf(tx, ctx)).find(
            (o) => o.id === op.objectId,
          )?.fields;
        else if (op.op === "update") {
          const [row] = await tx
            .select({ fields: objects.fields })
            .from(records)
            .innerJoin(objects, eq(objects.id, records.objectId))
            .where(
              and(
                eq(records.id, op.id),
                eq(records.workspaceId, ctx.workspaceId),
              ),
            );
          fields = row?.fields;
        }
        return new Set(
          ((fields ?? []) as Field[])
            .filter((f) => f.type === "ref" || f.type === "refs")
            .map((f) => f.key),
        );
      };
      for (const raw of ops) {
        const withId = {
          ...raw,
          ...("id" in raw && { id: ref(raw.id) as string }),
        } as TransactOp;
        const keys = "data" in withId ? await refKeys(withId) : new Set();
        const op = {
          ...withId,
          ...("data" in withId && {
            data: Object.fromEntries(
              Object.entries(withId.data).map(([k, v]) => [
                k,
                keys.has(k) ? ref(v) : v,
              ]),
            ),
          }),
        } as TransactOp;
        out.push(
          op.op === "delete"
            ? { deleted: await removeInTx(tx, ctx, op.id) }
            : op.op === "update"
              ? await updateInTx(tx, ctx, op.id, op.data, op.mode)
              : await upsertInTx(tx, ctx, op),
        );
      }
      return out;
    });
    for (const [i, r] of results.entries()) {
      if (!("deleted" in r)) await publishUpsert(ctx, ops[i] as never, r);
      else if (r.deleted)
        await publish("record.deleted", {
          ...ctx,
          id: r.deleted.id,
          objectId: r.deleted.objectId,
        });
    }
    return results;
  },

  upsert: async (ctx: TenantContext, input: UpsertInput) => {
    await requireScope(ctx, "write");
    const result = await withTenant(ctx, (tx) => upsertInTx(tx, ctx, input));
    await publishUpsert(ctx, input, result);
    return withPromotion(result);
  },

  // Upsert of several records of an object in a single transaction: one invalid
  // item rolls back the whole batch. Bus published after commit (audit in the tx).
  upsertBatch: async (
    ctx: TenantContext,
    objectId: string,
    items: Omit<UpsertInput, "objectId">[],
  ) => {
    await requireScope(ctx, "write");
    const results = await withTenant(ctx, async (tx) => {
      const out = [];
      for (const item of items)
        out.push(await upsertInTx(tx, ctx, { ...item, objectId }));
      return out;
    });
    for (const [i, result] of results.entries())
      await publishUpsert(ctx, items[i]!, result);
    return results;
  },
};
