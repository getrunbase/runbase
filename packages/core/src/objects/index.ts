// Objects with a typed schema: CRUD without migration, the schema lives in `fields`.
import { appError, notFound } from "../errors/app-error";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, count, eq, gt, inArray, sql } from "drizzle-orm";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { resolveDatabaseId } from "../databases";
import { publish } from "../bus";
import {
  deletedRecords,
  events,
  objects,
  recordKeys,
  records,
} from "../db/schema";
import { recordsService } from "../records";
import { csvLine } from "../records/csv";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import { db } from "../db/client";
import {
  applyComputed,
  baseType,
  fieldSchema,
  fieldsSchema,
  recordValidator,
  type Field,
} from "./fields";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export {
  fieldSchema,
  fieldsSchema,
  recordTitle,
  recordValidator,
  type Field,
} from "./fields";

type ObjectInput = {
  slug: string;
  name: string;
  icon?: string | null;
  fields: Field[];
  // Database slug; missing = "Default" database.
  database?: string;
};

const res = (id: string) => ({ type: "object", id });
const inWs = (ctx: TenantContext, id: string) =>
  and(eq(objects.id, id), eq(objects.workspaceId, ctx.workspaceId));

// Field made unique: keys built from existing records (fails
// on duplicates, with examples). Field no longer unique: keys deleted.
async function syncUniqueFields(
  tx: Tx,
  ctx: TenantContext,
  objectId: string,
  before: Field[],
  after: Field[],
) {
  const was = new Set(before.filter((f) => f.unique).map((f) => f.key));
  const now = after.filter((f) => f.unique);
  const dropped = [...was].filter((k) => !now.some((f) => f.key === k));
  if (dropped.length)
    await tx
      .delete(recordKeys)
      .where(
        and(
          eq(recordKeys.objectId, objectId),
          inArray(recordKeys.field, dropped),
        ),
      );
  for (const f of now.filter((f) => !was.has(f.key))) {
    const raw = sql`btrim(${records.data}->>${f.key})`;
    const v = f.type === "email" ? sql`lower(${raw})` : raw;
    const dups = await tx.execute<{ value: string; n: number }>(
      sql`select ${v} as value, count(*)::int as n from ${records}
        where ${records.objectId} = ${objectId} and coalesce(${raw}, '') <> ''
        group by 1 having count(*) > 1 order by 2 desc limit 5`,
    );
    if (dups.length)
      throw appError(
        "objects.uniqueDuplicates",
        "unique {field}: existing duplicates ({duplicates})",
        {
          field: f.key,
          duplicates: dups.map((d) => `${d.value} ×${d.n}`).join(", "),
        },
      );
    await tx.execute(
      sql`insert into record_keys (organization_id, object_id, field, value, record_id)
        select ${ctx.organizationId}, ${objectId}, ${f.key}, ${v}, ${records.id}
        from ${records}
        where ${records.objectId} = ${objectId} and coalesce(${raw}, '') <> ''`,
    );
  }
}

// Schema modified with formulas: values recomputed on all records
// (an added or rewritten formula also applies to existing data).
async function refreshFormulas(
  tx: Tx,
  objectId: string,
  before: Field[],
  after: Field[],
) {
  if (!after.some((f) => f.type === "formula")) return;
  if (isDeepStrictEqual(before, after)) return;
  for (let last = ""; ;) {
    const rows = await tx
      .select({ id: records.id, data: records.data })
      .from(records)
      .where(
        and(
          eq(records.objectId, objectId),
          last ? gt(records.id, last) : undefined,
        ),
      )
      .orderBy(asc(records.id))
      .limit(1000);
    if (!rows.length) return;
    last = rows.at(-1)!.id;
    for (const r of rows) {
      const data = applyComputed(after, r.data);
      if (!isDeepStrictEqual(data, r.data))
        await tx.update(records).set({ data }).where(eq(records.id, r.id));
    }
  }
}

async function refuseTypeChangeWithData(
  tx: Tx,
  ctx: TenantContext,
  id: string,
  next: unknown,
) {
  const [row] = await tx
    .select({ fields: objects.fields })
    .from(objects)
    .where(inWs(ctx, id));
  if (!row) return;
  const old = fieldsSchema.parse(row.fields);
  const parsed = fieldsSchema.safeParse(next);
  if (!parsed.success) return;
  for (const f of parsed.data) {
    const o = old.find((x) => x.key === f.key);
    if (!o || o.type === f.type || COMPUTED.includes(o.type)) continue;
    const [c] = await tx
      .select({ n: count() })
      .from(records)
      .where(
        and(
          eq(records.objectId, id),
          sql`${records.data} ->> ${f.key} is not null`,
        ),
      );
    if (c?.n)
      throw appError(
        "objects.typeChangeHasData",
        "Field {field} holds data in {count} record(s): changing its type from {from} to {to} would leave invalid values. Use objects.migrate with op change_type (dryRun first), or pass force: true",
        { field: f.key, count: c.n, from: o.type, to: f.type },
      );
  }
}
const COMPUTED = [
  "formula",
  "lookup",
  "rollup",
  "created_at",
  "updated_at",
  "created_by",
  "autonumber",
];

// Relation target: slug or uuid accepted as input, slug stored (the rest of the
// code compares slugs). Unknown target = error. `self`: object being created.
async function normalizeRefs(
  tx: Tx,
  ctx: TenantContext,
  fields: Field[],
  self?: string,
): Promise<Field[]> {
  const rows = await tx
    .select({ id: objects.id, slug: objects.slug })
    .from(objects)
    .where(eq(objects.workspaceId, ctx.workspaceId));
  return fields.map((f) => {
    if (f.type !== "ref" && f.type !== "refs") return f;
    if (f.object === self) return f;
    const t = rows.find((o) => o.slug === f.object || o.id === f.object);
    if (!t)
      throw appError(
        "objects.refTargetNotFound",
        "Field “{field}”: target object “{object}” not found",
        { field: f.key, object: String(f.object) },
      );
    return { ...f, object: t.slug };
  });
}

export type ExportFormat = "csv" | "json";
const EXPORT_PAGE = 1000;

// Schema evolution operations (objects.migrate), data included:
// - rename: key renamed, values copied under the new key;
// - change_type: values converted (text -> number, etc.), failures reported;
// - add: new field, `default` written into existing records;
// - require: field made mandatory, `default` for empty records;
// - delete: field removed from the schema and from all records;
// - update: properties merged into one field (label, options, formula
//   expression, validation), existing values checked against them.
// change_type: `map` rewrites values before conversion ({"Won": "won"}),
// `caseInsensitive` matches `map` keys and select options ignoring case.
export type MigrateOp =
  | { op: "rename"; field: string; to: string; label?: string }
  | {
      op: "change_type";
      field: string;
      type: Field["type"];
      options?: string[];
      object?: string;
      dropInvalid?: boolean;
      map?: Record<string, unknown>;
      caseInsensitive?: boolean;
    }
  | {
      op: "update";
      field: string;
      label?: string;
      options?: string[];
      // Formula expression (alias: formula).
      expression?: string;
      formula?: string;
      validation?: {
        pattern?: string | null;
        min?: number | null;
        max?: number | null;
        minLength?: number | null;
        maxLength?: number | null;
      };
      dropInvalid?: boolean;
    }
  | { op: "add"; field: Field; default?: unknown }
  | { op: "require"; field: string; default?: unknown }
  | { op: "delete"; field: string };

type Data = Record<string, unknown>;
// Effect of a migration on a record: null = unchanged; `error` = invalid
// value (reported; `data` removes it).
type Change = { data: Data; error?: string } | null;

const isEmpty = (v: unknown) =>
  v == null || v === "" || (Array.isArray(v) && !v.length);

function fieldOf(fields: Field[], key: string) {
  const f = fields.find((x) => x.key === key);
  if (!f)
    throw appError("objects.unknownField", "Unknown field: {field}", {
      field: key,
    });
  return f;
}

function checkValue(f: Field, v: unknown): string | null {
  const r = recordValidator([f]).safeParse({ [f.key]: v });
  return r.success ? null : (r.error.issues[0]?.message ?? "invalid value");
}

// Best-effort conversion of a value to the type of `f`; validation decides.
export function convertValue(v: unknown, f: Field): unknown {
  if (v === "" && f.type !== "text") return null;
  const s = Array.isArray(v)
    ? v.join(", ")
    : v !== null && typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
  switch (f.type) {
    case "text":
      return s;
    case "email":
    case "url":
    case "select":
    case "phone":
    case "user":
      return s.trim();
    case "number":
    case "currency":
    case "percent":
    case "rating": {
      if (typeof v === "number") return v;
      if (typeof v === "boolean") return Number(v);
      const n = Number(s.trim().replace(",", "."));
      return s.trim() !== "" && Number.isFinite(n) ? n : v;
    }
    case "bool":
      if (typeof v === "boolean") return v;
      if (/^(true|oui|yes|1)$/i.test(s.trim())) return true;
      if (/^(false|non|no|0)$/i.test(s.trim())) return false;
      return v;
    case "date": {
      if (typeof v !== "string" || Number.isNaN(Date.parse(v))) return v;
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(v).toISOString();
    }
    case "multi_select":
    case "refs":
      return Array.isArray(v)
        ? v.map(String)
        : s
            .split(/[;,]/)
            .map((x) => x.trim())
            .filter(Boolean);
    case "ref":
      return Array.isArray(v) ? (v[0] ?? null) : v;
    default:
      return v;
  }
}

// Migration plan: new schema, affected field and effect per record.
export function migrationPlan(before: Field[], op: MigrateOp) {
  const without = (d: Data, key: string) =>
    Object.fromEntries(Object.entries(d).filter(([k]) => k !== key));
  switch (op.op) {
    case "rename": {
      const f = fieldOf(before, op.field);
      if (before.some((x) => x.key === op.to))
        throw appError("objects.fieldExists", "Field already exists: {field}", {
          field: op.to,
        });
      return {
        field: f.key,
        fields: before.map((x) =>
          x.key === f.key
            ? { ...x, key: op.to, label: op.label ?? x.label }
            : x,
        ),
        apply: (d: Data): Change =>
          f.key in d
            ? { data: { ...without(d, f.key), [op.to]: d[f.key] } }
            : null,
      };
    }
    case "delete": {
      const f = fieldOf(before, op.field);
      return {
        field: f.key,
        fields: before.filter((x) => x.key !== f.key),
        apply: (d: Data): Change =>
          f.key in d ? { data: without(d, f.key) } : null,
      };
    }
    case "add":
    case "require": {
      const f =
        op.op === "add"
          ? fieldSchema.parse(op.field)
          : { ...fieldOf(before, op.field), required: true };
      if (op.op === "add" && before.some((x) => x.key === f.key))
        throw appError("objects.fieldExists", "Field already exists: {field}", {
          field: f.key,
        });
      if (op.default !== undefined) {
        const e = checkValue(f, op.default);
        if (e)
          throw appError(
            "objects.invalidDefault",
            "Invalid default value: {error}",
            { error: e },
          );
      }
      return {
        field: f.key,
        fields:
          op.op === "add"
            ? [...before, f]
            : before.map((x) => (x.key === f.key ? f : x)),
        apply: (d: Data): Change =>
          !isEmpty(d[f.key])
            ? null
            : op.default !== undefined
              ? { data: { ...d, [f.key]: op.default } }
              : f.required
                ? { data: d, error: "value required" }
                : null,
      };
    }
    case "change_type": {
      const old = fieldOf(before, op.field);
      const f = fieldSchema.parse({
        key: old.key,
        label: old.label,
        required: old.required,
        title: old.title,
        unique: old.unique,
        type: op.type,
        ...(op.options && { options: op.options }),
        ...(op.object && { object: op.object }),
      });
      const remap = valueMapper(f, op.map, op.caseInsensitive);
      return {
        field: f.key,
        fields: before.map((x) => (x.key === f.key ? f : x)),
        apply: (d: Data): Change => {
          if (d[f.key] == null) return null;
          const v = remap(convertValue(remap(d[f.key]), f));
          const error = checkValue(f, v);
          if (error) return { data: without(d, f.key), error };
          return isDeepStrictEqual(v, d[f.key])
            ? null
            : { data: { ...d, [f.key]: v } };
        },
      };
    }
    case "update": {
      const old = fieldOf(before, op.field);
      const next: Record<string, unknown> = { ...old };
      if (op.label !== undefined) next.label = op.label;
      if (op.options !== undefined) next.options = op.options;
      const formula = op.expression ?? op.formula;
      if (formula !== undefined) {
        if (old.type !== "formula")
          throw appError(
            "objects.migrateNotFormula",
            "Field {field} is not a formula: an expression applies to formula fields only",
            { field: old.key },
          );
        next.formula = formula;
      }
      for (const [k, v] of Object.entries(op.validation ?? {}))
        if (v === null) delete next[k];
        else if (v !== undefined) next[k] = v;
      const f = fieldSchema.parse(next);
      return {
        field: f.key,
        fields: before.map((x) => (x.key === f.key ? f : x)),
        apply: (d: Data): Change => {
          if (f.type === "formula" || d[f.key] == null) return null;
          const error = checkValue(f, d[f.key]);
          return error ? { data: without(d, f.key), error } : null;
        },
      };
    }
  }
}

// Value rewriting for change_type: explicit `map`, then (caseInsensitive)
// select options matched ignoring case. Arrays are mapped item by item.
function valueMapper(
  f: Field,
  map: Record<string, unknown> | undefined,
  caseInsensitive: boolean | undefined,
) {
  const norm = (s: string) => (caseInsensitive ? s.trim().toLowerCase() : s);
  const entries = new Map(
    Object.entries(map ?? {}).map(([k, v]) => [norm(k), v]),
  );
  const options = "options" in f ? f.options : [];
  const one = (x: unknown): unknown => {
    if (typeof x !== "string") return x;
    const k = norm(x);
    if (entries.has(k)) return entries.get(k);
    if (caseInsensitive) return options.find((o) => norm(o) === k) ?? x;
    return x;
  };
  if (!entries.size && !caseInsensitive) return (v: unknown) => v;
  return (v: unknown) => (Array.isArray(v) ? v.map(one) : one(v));
}

// Deletion of an object in a transaction: its records (and its trash)
// cascade, their events stay unlinked. Returns the deleted
// records to publish record.deleted after commit.
export async function removeObjectInTx(tx: Tx, ctx: TenantContext, id: string) {
  const deleted = await tx
    .select({ id: records.id })
    .from(records)
    .where(
      and(eq(records.objectId, id), eq(records.workspaceId, ctx.workspaceId)),
    );
  for (const table of [records, deletedRecords])
    await tx
      .update(events)
      .set({ recordId: null })
      .where(
        and(
          eq(events.workspaceId, ctx.workspaceId),
          inArray(
            events.recordId,
            tx
              .select({ id: table.id })
              .from(table)
              .where(eq(table.objectId, id)),
          ),
        ),
      );
  const [row] = await tx.delete(objects).where(inWs(ctx, id)).returning();
  if (!row) return { row: null, deleted: [] };
  await audit(tx, ctx, "object.delete", res(id), {
    ...row,
    records: deleted.length,
  });
  return { row, deleted: deleted.map((d) => ({ id: d.id, objectId: id })) };
}

// Publication after commit of the records deleted with their object.
export async function publishDeleted(
  ctx: TenantContext,
  deleted: { id: string; objectId: string }[],
) {
  for (const r of deleted) await publish("record.deleted", { ...ctx, ...r });
}

export const objectsService = {
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select()
        .from(objects)
        .where(eq(objects.workspaceId, ctx.workspaceId))
        .orderBy(objects.createdAt),
    );
  },
  // `slug`: slug or uuid of the object.
  get: async (ctx: TenantContext, slug: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(objects)
        .where(
          and(
            eq(objects.workspaceId, ctx.workspaceId),
            UUID.test(slug) ? eq(objects.id, slug) : eq(objects.slug, slug),
          ),
        );
      return row ?? null;
    });
  },
  create: async (ctx: TenantContext, input: ObjectInput) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      const fields = await normalizeRefs(
        tx,
        ctx,
        fieldsSchema.parse(input.fields),
        input.slug,
      );
      const databaseId = await resolveDatabaseId(tx, ctx, input.database);
      const [row] = await tx
        .insert(objects)
        .values({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          databaseId,
          slug: input.slug,
          name: input.name,
          icon: input.icon ?? null,
          fields,
        })
        .returning();
      await audit(tx, ctx, "object.create", res(row!.id), input);
      return row!;
    });
  },
  // A type change on a field that holds data is refused (values would be
  // left invalid) unless `force`: objects.migrate change_type converts them.
  update: async (
    ctx: TenantContext,
    id: string,
    patch: Partial<Omit<ObjectInput, "slug" | "database">>,
    opts: { force?: boolean } = {},
  ) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      if (patch.fields && !opts.force)
        await refuseTypeChangeWithData(tx, ctx, id, patch.fields);
      const set = {
        ...patch,
        ...(patch.fields && {
          fields: await normalizeRefs(
            tx,
            ctx,
            fieldsSchema.parse(patch.fields),
          ),
        }),
        updatedAt: new Date(),
      };
      const [before] = await tx
        .select({ fields: objects.fields })
        .from(objects)
        .where(inWs(ctx, id))
        .for("update");
      const [row] = await tx
        .update(objects)
        .set(set)
        .where(inWs(ctx, id))
        .returning();
      if (row && set.fields) {
        const old = fieldsSchema.parse(before?.fields ?? []);
        await syncUniqueFields(tx, ctx, id, old, set.fields);
        await refreshFormulas(tx, id, old, set.fields);
      }
      if (row) await audit(tx, ctx, "object.update", res(id), patch);
      return row ?? null;
    });
  },
  // Permanent deletion of the object and its records (trash included).
  // Without `confirm: true`: refused, with the number of records at stake
  // (export them first with objects.export).
  remove: async (
    ctx: TenantContext,
    id: string,
    opts: { confirm?: boolean } = {},
  ) => {
    await requireScope(ctx, "admin");
    const { row, deleted } = await withTenant(ctx, async (tx) => {
      if (!opts.confirm) {
        const [c] = await tx
          .select({ n: count() })
          .from(records)
          .where(
            and(
              eq(records.objectId, id),
              eq(records.workspaceId, ctx.workspaceId),
            ),
          );
        throw appError(
          "objects.deleteConfirm",
          "Permanent deletion of the object and its {count} record(s). Export first (objects.export), then confirm (confirm: true).",
          { count: c?.n ?? 0 },
          { kind: "confirm_required" },
        );
      }
      return removeObjectInTx(tx, ctx, id);
    });
    await publishDeleted(ctx, deleted);
    return row;
  },
  // Export of all records, page by page (1000 per page, no total
  // limit): columns id, external_id, one field per column, dates. `next` =
  // cursor of the next page (null at the end of the export). In CSV, the header is
  // on the first page only.
  export: async (
    ctx: TenantContext,
    id: string,
    opts: { format?: ExportFormat; after?: string } = {},
  ) => {
    const object = await objectsService.get(ctx, id);
    if (!object) throw notFound("objects.notFound", "Object not found");
    const fields = fieldsSchema.parse(object.fields);
    const rows = await recordsService.search(ctx, object.id, {
      pagination: { limit: EXPORT_PAGE, after: opts.after },
    });
    const next = rows.length === EXPORT_PAGE ? rows.at(-1)!.id : null;
    const flat = rows.map((r) => ({
      id: r.id,
      external_id: r.externalId,
      ...Object.fromEntries(fields.map((f) => [f.key, r.data[f.key] ?? null])),
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    }));
    if (opts.format === "json") return { rows: flat, next };
    const header = opts.after
      ? ""
      : csvLine([
          "id",
          "external_id",
          ...fields.map((f) => f.key),
          "created_at",
          "updated_at",
        ]);
    return {
      csv: header + flat.map((r) => csvLine(Object.values(r))).join(""),
      next,
    };
  },
  // Schema evolution with data migration (see MigrateOp). dryRun:
  // impact preview (records touched, invalid values, examples) without writing
  // anything. A conversion with invalid values is refused, unless
  // dropInvalid (invalid values cleared).
  migrate: async (
    ctx: TenantContext,
    id: string,
    op: MigrateOp,
    opts: { dryRun?: boolean } = {},
  ) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      const [object] = await tx
        .select()
        .from(objects)
        .where(inWs(ctx, id))
        .for("update");
      if (!object) throw notFound("objects.notFound", "Object not found");
      const before = fieldsSchema.parse(object.fields);
      const plan = migrationPlan(before, op);
      const after = await normalizeRefs(
        tx,
        ctx,
        fieldsSchema.parse(plan.fields),
      );
      const report = {
        records: 0,
        touched: 0,
        invalid: 0,
        samples: [] as { id: string; value: unknown; error: string }[],
        // Up to 5 changed records: value of the field before and after
        // (normalized, or recomputed for a formula).
        examples: [] as { id: string; before: unknown; after: unknown }[],
      };
      const writes: { id: string; data: Record<string, unknown> }[] = [];
      for (let last = ""; ;) {
        const rows = await tx
          .select({ id: records.id, data: records.data })
          .from(records)
          .where(
            and(
              eq(records.objectId, id),
              last ? gt(records.id, last) : undefined,
            ),
          )
          .orderBy(asc(records.id))
          .limit(1000);
        if (!rows.length) break;
        last = rows.at(-1)!.id;
        for (const r of rows) {
          report.records++;
          const out = plan.apply(r.data);
          // Computed fields (formulas) follow the new schema: a record
          // whose formula result changes counts as touched.
          const data = applyComputed(after, out?.data ?? r.data);
          if (!out && isDeepStrictEqual(data, r.data)) continue;
          report.touched++;
          if (report.examples.length < 5)
            report.examples.push({
              id: r.id,
              before: r.data[plan.field] ?? null,
              after: data[op.op === "rename" ? op.to : plan.field] ?? null,
            });
          if (out?.error) {
            report.invalid++;
            if (report.samples.length < 10)
              report.samples.push({
                id: r.id,
                value: r.data[plan.field],
                error: out.error,
              });
          }
          writes.push({ id: r.id, data });
        }
      }
      if (opts.dryRun) return { dryRun: true, ...report };
      const canDrop =
        (op.op === "change_type" || op.op === "update") && op.dropInvalid;
      if (report.invalid && !canDrop) {
        const p = {
          count: report.invalid,
          samples: report.samples
            .slice(0, 3)
            .map((x) => `${x.id}: ${x.error}`)
            .join("; "),
        };
        throw op.op === "change_type" || op.op === "update"
          ? appError(
              "objects.migrateInvalidValues",
              "{count} invalid record(s) after migration (e.g. {samples}): fix the values or pass dropInvalid",
              p,
            )
          : appError(
              "objects.migrateNeedsDefault",
              "{count} invalid record(s) after migration (e.g. {samples}): provide a default value (default)",
              p,
            );
      }
      for (const w of writes)
        await tx
          .update(records)
          .set({ data: w.data, updatedAt: new Date() })
          .where(eq(records.id, w.id));
      await tx
        .update(objects)
        .set({ fields: after, updatedAt: new Date() })
        .where(inWs(ctx, id));
      await tx
        .delete(recordKeys)
        .where(
          and(eq(recordKeys.objectId, id), eq(recordKeys.field, plan.field)),
        );
      await syncUniqueFields(
        tx,
        ctx,
        id,
        before.filter((f) => f.key !== plan.field),
        after,
      );
      await refreshFormulas(tx, id, before, after);
      await audit(tx, ctx, "object.migrate", res(id), {
        op,
        touched: report.touched,
        invalid: report.invalid,
      });
      return { dryRun: false, ...report };
    });
  },
  // On-demand index on a field (frequent filters and sorts): partial
  // index on the expression used by filters, created without blocking
  // writes (CONCURRENTLY, outside a transaction). Idempotent.
  index: async (ctx: TenantContext, id: string, key: string) => {
    await requireScope(ctx, "admin");
    const object = await objectsService.get(ctx, id);
    if (!object) throw notFound("objects.notFound", "Object not found");
    const f = fieldsSchema.parse(object.fields).find((x) => x.key === key);
    if (!f)
      throw appError("objects.unknownField", "Unknown field: {field}", {
        field: key,
      });
    const b = baseType(f);
    if (b === "virtual" || b === "file")
      throw appError(
        "objects.notIndexable",
        "{field}: field cannot be indexed",
        { field: key },
      );
    // Key validated by fieldSchema (^[a-z][a-z0-9_]*$), database uuid id.
    const name = recordIndexName(object.id, key);
    // Shared `records` table: indexes capped per workspace (an
    // existing index is not counted again: idempotent call).
    const existing = await workspaceIndexes(
      (await objectsService.list(ctx)).map((o) => o.id),
    );
    if (
      !existing.includes(name) &&
      existing.length >= MAX_INDEXES_PER_WORKSPACE
    )
      throw appError(
        "objects.indexQuota",
        "Index limit reached for this workspace ({max})",
        { max: MAX_INDEXES_PER_WORKSPACE },
        { kind: "quota_exceeded" },
      );
    const expr =
      b === "number"
        ? `((data->>'${key}')::numeric)`
        : ["multi_select", "refs", "json"].includes(b)
          ? `(data->'${key}')`
          : `(data->>'${key}')`;
    const using = expr.startsWith("(data->'") ? "gin" : "btree";
    await db.execute(
      sql.raw(
        `create index concurrently if not exists "${name}" on records using ${using} (${expr}) where object_id = '${object.id}'`,
      ),
    );
    await withTenant(ctx, (tx) =>
      audit(tx, ctx, "object.index", res(object.id), { field: key, name }),
    );
    return { index: name, field: key };
  },
  // Dynamic validator of a record from its object's schema.
  validator: (object: { fields: unknown }) =>
    recordValidator(fieldsSchema.parse(object.fields)),
};

// On-demand field indexes per workspace (shared `records` table).
export const MAX_INDEXES_PER_WORKSPACE = 20;

// Index name: hash of (object, field), no collision through truncation
// (Postgres names are cut at 63 bytes).
export const recordIndexName = (objectId: string, key: string) =>
  `records_idx_${createHash("sha256")
    .update(`${objectId}:${key}`)
    .digest("hex")
    .slice(0, 32)}`;

// On-demand indexes of the given objects (partial on object_id).
async function workspaceIndexes(objectIds: string[]): Promise<string[]> {
  if (!objectIds.length) return [];
  const rows = (await db.execute(
    sql`select indexname, indexdef from pg_indexes
        where tablename = 'records' and indexname like 'records_idx_%'`,
  )) as unknown as { indexname: string; indexdef: string }[];
  const ids = new Set(objectIds);
  return rows
    .filter((r) => {
      const m = /object_id = '([0-9a-f-]{36})'/.exec(r.indexdef);
      return !!m && ids.has(m[1]!);
    })
    .map((r) => r.indexname);
}

// Full streamed export ("Export" button of the object view): chains the
// pages d'objects.export.
export async function* exportStream(
  ctx: TenantContext,
  id: string,
  format: ExportFormat,
) {
  let after: string | undefined;
  let first = true;
  if (format === "json") yield "[";
  do {
    const page = await objectsService.export(ctx, id, { format, after });
    if ("csv" in page) yield page.csv;
    else
      for (const r of page.rows) {
        yield (first ? "\n" : ",\n") + JSON.stringify(r);
        first = false;
      }
    after = page.next ?? undefined;
  } while (after);
  if (format === "json") yield "\n]\n";
}
