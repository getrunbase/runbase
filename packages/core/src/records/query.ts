// Record reads: scoped filters, keyset search, relation hops and
// virtual (lookup / rollup) fields.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { appError, notFound } from "../errors/app-error";
import { anyUuid } from "../db/any";
import { requireScope } from "../api-keys";
import { objects, records } from "../db/schema";
import { baseType, fieldsSchema, VIRTUAL, type Field } from "../objects/fields";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import {
  compileFilter,
  fieldExpr,
  resolveRelation,
  type Filter,
  type Hop,
  type SchemaGraph,
} from "../filter";
import { graphOf, page } from "./helpers";
import type { RecordRow, SearchInput } from "./types";

// Workspace object, its fields and the compiled filter (search / aggregate).
export async function scoped(
  tx: Tx,
  ctx: TenantContext,
  objectId: string,
  filter?: Filter,
  q?: string,
) {
  const [object] = await tx
    .select()
    .from(objects)
    .where(
      and(eq(objects.id, objectId), eq(objects.workspaceId, ctx.workspaceId)),
    );
  if (!object) throw notFound("objects.notFound", "Object not found");
  const fields = fieldsSchema.parse(object.fields);
  const where = filter
    ? compileFilter(
        records.data,
        fields,
        filter,
        await graphOf(tx, ctx, object.slug),
      )
    : sql`true`;
  const text = fields.filter((f) => ["text", "email", "url"].includes(f.type));
  const like = `%${(q ?? "").trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  // data::text prefilter (trigram index) then per-field check. No
  // prefilter if q contains " or \ (escaped in the JSON text).
  const pre = /["\\]/.test(q ?? "")
    ? sql`true`
    : sql`${records.data}::text ilike ${like}`;
  const search =
    q?.trim() && text.length
      ? sql`(${pre} and (${sql.join(
          text.map((f) => sql`${records.data}->>${f.key} ilike ${like}`),
          sql` or `,
        )}))`
      : q?.trim()
        ? sql`false`
        : sql`true`;
  return { object, fields, where: and(where, search)! };
}

// Search: DSL filter compiled into parameterized SQL, typed sort.
// Keyset (`after`): on the default order (created_at desc, id asc, index
// records_object_created_idx) or on a single-field sort (nulls last).
export const NUMERIC: string[] = [
  "number",
  "currency",
  "percent",
  "rating",
  "autonumber",
];

export async function searchIn(
  ctx: TenantContext,
  objectId: string,
  input: SearchInput,
  withTotal = false,
) {
  await requireScope(ctx, "read");
  return withTenant(ctx, async (tx) => {
    const { object, fields, where } = await scoped(
      tx,
      ctx,
      objectId,
      input.filter,
      input.q,
    );
    const sorts = (input.sort ?? []).map((s) => {
      const f = fields.find((x) => x.key === s.field);
      // System columns sortable when no schema field has that name.
      if (!f && (s.field === "created_at" || s.field === "updated_at"))
        return {
          e: sql`${s.field === "created_at" ? records.createdAt : records.updatedAt}`,
          desc: s.dir === "desc",
        };
      if (!f)
        throw appError("objects.unknownField", "Unknown field: {field}", {
          field: s.field,
        });
      if (baseType(f) === "virtual")
        throw appError(
          "records.computedNotSortable",
          "{field}: computed field cannot be sorted",
          { field: f.key },
        );
      return { e: fieldExpr(records.data, f), desc: s.dir === "desc" };
    });
    const order = sorts.map((s) =>
      s.desc ? sql`${s.e} desc nulls last` : sql`${s.e} asc nulls last`,
    );
    const { limit } = page(input.pagination);
    const after = input.pagination?.after;
    // Keyset on (sorts..., created_at desc, id asc), nulls last:
    // rows strictly after the cursor record in that order.
    let keyset = sql`true`;
    if (after) {
      const at = sql`(select created_at from records where id = ${after})`;
      keyset = sql`(${records.createdAt} < ${at} or (${records.createdAt} = ${at} and ${records.id} > ${after}))`;
      for (const { e, desc: d } of [...sorts].reverse()) {
        // Sort value of the cursor record, same typed expression.
        const v = sql`(select ${e} from records where id = ${after})`;
        const beyond = d ? sql`${e} < ${v}` : sql`${e} > ${v}`;
        keyset = sql`(case when ${v} is null then (${e} is null and ${keyset})
          else (${beyond} or ${e} is null or (${e} = ${v} and ${keyset})) end)`;
      }
    }
    const base = and(eq(records.objectId, object.id), where);
    const rows = await tx
      .select()
      .from(records)
      .where(and(base, keyset))
      .orderBy(...order, desc(records.createdAt), asc(records.id))
      .limit(limit);
    const total = withTotal
      ? (
          await tx
            .select({ n: sql<number>`count(*)`.mapWith(Number) })
            .from(records)
            .where(base)
        )[0]!.n
      : undefined;
    const virtual = fields.some((f) => VIRTUAL.includes(f.type));
    return {
      records: virtual
        ? await withVirtual(
            tx,
            ctx,
            fields,
            await graphOf(tx, ctx, object.slug),
            rows,
          )
        : rows,
      total,
    };
  });
}

// One relation hop for all records of `cur`: a single query.
export async function hop(
  tx: Tx,
  ctx: TenantContext,
  cur: RecordRow[],
  h: Hop,
) {
  const inWs = and(
    eq(records.workspaceId, ctx.workspaceId),
    eq(records.objectId, h.objectId),
  );
  if (h.kind === "inverse") {
    const ids = cur.map((r) => r.id);
    if (!ids.length) return [];
    const any = sql.join(
      ids.map((i) => sql`${i}`),
      sql`, `,
    );
    return tx
      .select()
      .from(records)
      .where(
        and(
          inWs,
          h.many
            ? sql`jsonb_exists_any(${records.data}->${h.key}, array[${any}]::text[])`
            : sql`(${records.data}->>${h.key}) in (${any})`,
        ),
      )
      .orderBy(asc(records.createdAt));
  }
  const ids = [...new Set(cur.flatMap((r) => r.data[h.key] ?? []))].filter(
    (x): x is string => typeof x === "string",
  );
  return ids.length
    ? tx
        .select()
        .from(records)
        .where(and(inWs, anyUuid(records.id, ids)))
        .orderBy(asc(records.createdAt))
    : [];
}

// lookup / rollup fields, computed on read for a page of records:
// one query per field (a single relation hop), then distribution.
export async function withVirtual(
  tx: Tx,
  ctx: TenantContext,
  fields: Field[],
  graph: SchemaGraph,
  rows: RecordRow[],
): Promise<RecordRow[]> {
  const virtual = fields.filter((f) => VIRTUAL.includes(f.type));
  if (!virtual.length || !rows.length) return rows;
  const out = rows.map((r) => ({ ...r, data: { ...r.data } }));
  for (const f of virtual) {
    if (f.type !== "lookup" && f.type !== "rollup") continue;
    let h: Hop;
    try {
      h = resolveRelation(fields, graph, f.through)[0]!;
    } catch {
      continue;
    }
    const linked = await hop(tx, ctx, rows, h);
    for (const r of out) {
      const related = linked.filter((l) =>
        h.kind === "inverse"
          ? [l.data[h.key] ?? []].flat().includes(r.id)
          : [r.data[h.key] ?? []].flat().includes(l.id),
      );
      const values = related.map((l) => (f.field ? l.data[f.field] : null));
      if (f.type === "lookup") {
        r.data[f.key] =
          h.kind === "ref"
            ? (values[0] ?? null)
            : values.filter((v) => v != null);
        continue;
      }
      const nums = values.map(Number).filter((n) => Number.isFinite(n));
      r.data[f.key] =
        f.op === "count"
          ? related.length
          : !nums.length
            ? null
            : f.op === "sum"
              ? nums.reduce((a, b) => a + b, 0)
              : f.op === "avg"
                ? nums.reduce((a, b) => a + b, 0) / nums.length
                : f.op === "min"
                  ? Math.min(...nums)
                  : Math.max(...nums);
    }
  }
  return out;
}

// Records linked by a relation path (include): one record (or null) if
// all hops are refs, otherwise a list.
export async function follow(
  tx: Tx,
  ctx: TenantContext,
  root: RecordRow,
  fields: Field[],
  graph: SchemaGraph,
  path: string,
) {
  const hops = resolveRelation(fields, graph, path);
  let cur: RecordRow[] = [root];
  for (const h of hops) cur = await hop(tx, ctx, cur, h);
  return hops.every((h) => h.kind === "ref") ? (cur[0] ?? null) : cur;
}
