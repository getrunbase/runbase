// Internal helpers shared by record reads and writes: computed fields,
// audit diffs, timeline events, unique keys, reference checks.
import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import { appError } from "../errors/app-error";
import { anyUuid } from "../db/any";
import { events, objects, recordKeys, records } from "../db/schema";
import {
  applyComputed,
  recordValidator,
  uniqueValue,
  withDefaults,
  type Field,
} from "../objects/fields";
import { schemaGraph } from "../filter";
import type { TenantContext, Tx } from "../tenant";
import { isUuid } from "../lib/uuid";
import type { Data, ObjectRow, SearchInput } from "./types";

// Keys whose value differs between two versions of `data`.
export function changedFields(before: Data, after: Data): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((k) => !isDeepStrictEqual(before[k], after[k]))
    .sort();
}

const STAMPS: Field["type"][] = [
  "created_at",
  "updated_at",
  "created_by",
  "autonumber",
];

// Author of a write (created_by field): user or API key.
const actorOf = (ctx: TenantContext) =>
  "userId" in ctx.actor ? ctx.actor.userId : `api_key:${ctx.actor.apiKeyId}`;

// Computed fields of a modified existing record: formulas recomputed, then
// updated_at set only if something changed.
export function recompute(fields: Field[], before: Data, next: Data) {
  const kept = { ...next };
  // Replace mode: values set by the platform are kept.
  for (const f of fields)
    if (STAMPS.includes(f.type) && before[f.key] !== undefined)
      kept[f.key] = before[f.key];
  const out = applyComputed(fields, kept);
  if (!changedFields(before, out).length) return out;
  const now = new Date().toISOString();
  for (const f of fields) if (f.type === "updated_at") out[f.key] = now;
  return out;
}

// Data of a new record: defaults, computed fields, autonumber
// (max + 1 under a transactional lock per object).
export async function prepareNew(
  tx: Tx,
  ctx: TenantContext,
  objectId: string,
  fields: Field[],
  data: Data,
) {
  const out = applyComputed(fields, withDefaults(fields, data), {
    created: { at: new Date().toISOString(), by: actorOf(ctx) },
  });
  const autos = fields.filter((f) => f.type === "autonumber");
  if (autos.length)
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`autonumber:${objectId}`}, 0))`,
    );
  for (const f of autos) {
    const [row] = await tx.execute<{ n: number }>(
      sql`select coalesce(max((${records.data}->>${f.key})::numeric), 0)::int + 1 as n
        from ${records} where ${records.objectId} = ${objectId}`,
    );
    out[f.key] = row!.n;
  }
  return out;
}

// Subset of `data` limited to `keys`.
export const pick = (data: Data, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));

// Audit diff of a modification: before / after values of the modified fields
// (records.history, records.revert).
export const updateDiff = (before: Data, after: Data, changed: string[]) => ({
  changed,
  before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
  after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
});

// Merge: only written values (`touched`) are strictly
// validated. An old value that became invalid after a schema change,
// and is not modified, does not block the update.
export function validateMerge(
  validate: ReturnType<typeof recordValidator>,
  merged: Data,
  touched: string[],
): Data {
  const r = validate.safeParse(merged);
  if (r.success) return r.data as Data;
  const blocking = r.error.issues.some(
    (i) => !i.path.length || touched.includes(String(i.path[0])),
  );
  if (blocking) throw r.error;
  return merged;
}

// Timeline event of a record (record.created / record.updated) with the diff
// of the modified fields: payload {changes: {<field>: {from, to}}}. Written without
// publishing event.received (workflows already listen to record.*).
export async function timelineEvent(
  tx: Tx,
  ctx: TenantContext,
  recordId: string,
  type: "record.created" | "record.updated",
  before: Data,
  after: Data,
  changed: string[],
) {
  await tx.insert(events).values({
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    recordId,
    type,
    payload: {
      changes: Object.fromEntries(
        changed.map((k) => [
          k,
          { from: before[k] ?? null, to: after[k] ?? null },
        ]),
      ),
    },
    source: "records",
    isTest: ctx.test ?? false,
  });
}

// Workspace objects read once per transaction (upsert batches: avoids
// one schema read per item).
export const txObjects = new WeakMap<Tx, Promise<ObjectRow[]>>();
export function objectsOf(tx: Tx, ctx: TenantContext) {
  let rows = txObjects.get(tx);
  if (!rows) {
    rows = tx
      .select()
      .from(objects)
      .where(eq(objects.workspaceId, ctx.workspaceId));
    txObjects.set(tx, rows);
  }
  return rows;
}

// Schemas of all workspace objects (all databases), seen from `self`.
export async function graphOf(tx: Tx, ctx: TenantContext, self: string) {
  return schemaGraph(self, await objectsOf(tx, ctx));
}

// Unique keys of a record (record_keys): replaced by the values of
// `data`. A value already taken by another record aborts the transaction.
export async function syncKeys(
  tx: Tx,
  ctx: TenantContext,
  objectId: string,
  fields: Field[],
  recordId: string,
  data: Data,
) {
  const uniq = fields.filter((f) => f.unique);
  if (!uniq.length) return;
  await tx.delete(recordKeys).where(
    and(
      eq(recordKeys.recordId, recordId),
      inArray(
        recordKeys.field,
        uniq.map((f) => f.key),
      ),
    ),
  );
  const rows = uniq.flatMap((f) => {
    const value = uniqueValue(f, data[f.key]);
    return value === null
      ? []
      : [
          {
            organizationId: ctx.organizationId,
            objectId,
            field: f.key,
            value,
            recordId,
          },
        ];
  });
  if (!rows.length) return;
  const ok = await tx
    .insert(recordKeys)
    .values(rows)
    .onConflictDoNothing()
    .returning({ field: recordKeys.field });
  const dup = rows.find((r) => !ok.some((o) => o.field === r.field));
  if (dup)
    throw appError(
      "records.valueTaken",
      "Value already in use: {field} = {value}",
      { field: dup.field, value: String(dup.value) },
    );
}

export const page = (p: SearchInput["pagination"]) => ({
  limit: Math.min(Math.max(p?.limit ?? 50, 1), 1000),
});

// Targets of ref / refs fields must exist in the workspace.
export async function checkRefs(
  tx: Tx,
  ctx: TenantContext,
  fields: Field[],
  data: Data,
) {
  const rels = fields.filter((f) => f.type === "ref" || f.type === "refs");
  if (!rels.length) return;
  const graph = await graphOf(tx, ctx, "");
  for (const f of rels) {
    const v = data[f.key];
    const ids = [...new Set(Array.isArray(v) ? v : v ? [v] : [])] as string[];
    if (!ids.length) continue;
    // Malformed relation id: invalid reference, without a query.
    if (!ids.every(isUuid))
      throw appError("records.invalidRef", "Invalid reference: {field}", {
        field: f.key,
      });
    // Target stored as slug, or as uuid for schemas older than the
    // normalisation (7e7cea2).
    const ref = (f as { object: string }).object;
    const target =
      graph.objects[ref] ??
      Object.values(graph.objects).find((o) => o.id === ref);
    const found = target
      ? await tx
          .select({ id: records.id })
          .from(records)
          .where(
            and(
              eq(records.workspaceId, ctx.workspaceId),
              eq(records.objectId, target.id),
              anyUuid(records.id, ids),
            ),
          )
      : [];
    if (found.length !== ids.length)
      throw appError("records.invalidRef", "Invalid reference: {field}", {
        field: f.key,
      });
  }
}
