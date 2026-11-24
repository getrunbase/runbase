// Read operations of recordsService: count, get, path resolution,
// filter match, search and aggregation.
import { and, eq, sql, type SQL } from "drizzle-orm";
import { appError, notFound } from "../errors/app-error";
import { requireScope } from "../api-keys";
import { objects, records } from "../db/schema";
import { fieldsSchema } from "../objects/fields";
import { withTenant, type TenantContext } from "../tenant";
import {
  compileFilter,
  fieldExpr,
  resolveRelation,
  type Filter,
  type Hop,
} from "../filter";
import { isUuid } from "../lib/uuid";
import { graphOf, page } from "./helpers";
import { follow, hop, NUMERIC, scoped, searchIn, withVirtual } from "./query";
import {
  MAX_TEMPLATE_HOPS,
  type AggregateInput,
  type Data,
  type RecordRow,
  type SearchInput,
} from "./types";

export const readOps = {
  // Total number of records in the workspace (home KPI).
  count: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(records)
        .where(eq(records.workspaceId, ctx.workspaceId));
      return row?.n ?? 0;
    });
  },

  // Read of a record with its resolved refs: `refs.<key>`.
  // `include`: relation paths, e.g. `entreprise`,
  // `contact.entreprise`, `contact` (inverse) -> `included.<path>`.
  get: async (
    ctx: TenantContext,
    id: string,
    opts: { include?: string[] } = {},
  ) => {
    await requireScope(ctx, "read");
    if (!isUuid(id)) throw notFound("records.notFound", "Record not found");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({ record: records, object: objects })
        .from(records)
        .innerJoin(objects, eq(objects.id, records.objectId))
        .where(
          and(eq(records.id, id), eq(records.workspaceId, ctx.workspaceId)),
        );
      if (!row) throw notFound("records.notFound", "Record not found");
      const fields = fieldsSchema.parse(row.object.fields);
      const graph = await graphOf(tx, ctx, row.object.slug);
      const refs: Record<string, RecordRow | null> = {};
      for (const f of fields)
        if (f.type === "ref" && graph.objects[f.object])
          refs[f.key] =
            typeof row.record.data[f.key] === "string"
              ? ((await follow(
                  tx,
                  ctx,
                  row.record,
                  fields,
                  graph,
                  f.key,
                )) as RecordRow | null)
              : null;
      const included: Record<string, RecordRow | RecordRow[] | null> = {};
      for (const path of opts.include ?? [])
        included[path] = await follow(tx, ctx, row.record, fields, graph, path);
      const [record] = await withVirtual(tx, ctx, fields, graph, [row.record]);
      return { ...record!, refs, included };
    });
  },

  // Values of field paths seen from a record (templates):
  // `nom`, `contact.entreprise.nom`, `deals.montant` (inverse -> list).
  // At most MAX_TEMPLATE_HOPS hops; a shared hop is queried only once.
  // Invalid path -> undefined.
  resolvePaths: async (ctx: TenantContext, id: string, paths: string[]) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const out: Record<string, unknown> = {};
      const [row] = await tx
        .select({ record: records, object: objects })
        .from(records)
        .innerJoin(objects, eq(objects.id, records.objectId))
        .where(
          and(eq(records.id, id), eq(records.workspaceId, ctx.workspaceId)),
        );
      if (!row) return out;
      const fields = fieldsSchema.parse(row.object.fields);
      const graph = await graphOf(tx, ctx, row.object.slug);
      const cache = new Map<string, RecordRow[]>([["", [row.record]]]);
      for (const path of paths) {
        const segs = path.split(".");
        // Longest valid relation prefix, leaving a final field.
        let hops: Hop[] = [];
        for (let k = 1; k < segs.length && k <= MAX_TEMPLATE_HOPS; k++) {
          try {
            hops = resolveRelation(fields, graph, segs.slice(0, k).join("."));
          } catch {
            break;
          }
        }
        let cur = [row.record];
        for (let i = 0; i < hops.length; i++) {
          const key = segs.slice(0, i + 1).join(".");
          let next = cache.get(key);
          if (!next) {
            next = await hop(tx, ctx, cur, hops[i]!);
            cache.set(key, next);
          }
          cur = next;
        }
        const pick = (r: RecordRow) =>
          segs
            .slice(hops.length)
            .reduce<unknown>(
              (o, k) => (o == null ? undefined : (o as Data)[k]),
              r.data,
            );
        out[path] = hops.every((h) => h.kind === "ref")
          ? cur[0] && pick(cur[0])
          : cur.map(pick);
      }
      return out;
    });
  },

  // Does the record match the filter? Evaluated in SQL, paths included
  // (condition block).
  matches: async (ctx: TenantContext, id: string, filter: Filter) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({ object: objects })
        .from(records)
        .innerJoin(objects, eq(objects.id, records.objectId))
        .where(
          and(eq(records.id, id), eq(records.workspaceId, ctx.workspaceId)),
        );
      if (!row) throw notFound("records.notFound", "Record not found");
      const where = compileFilter(
        records.data,
        fieldsSchema.parse(row.object.fields),
        filter,
        await graphOf(tx, ctx, row.object.slug),
      );
      const hit = await tx
        .select({ id: records.id })
        .from(records)
        .where(and(eq(records.id, id), where));
      return hit.length > 0;
    });
  },

  // Search: DSL filter compiled into parameterized SQL, typed sort.
  search: async (
    ctx: TenantContext,
    objectId: string,
    input: SearchInput = {},
  ) => (await searchIn(ctx, objectId, input)).records,

  // Search with pagination metadata: `hasMore`, `total` (number of
  // records matching the filter) and `next` (cursor for `after`).
  searchPage: async (
    ctx: TenantContext,
    objectId: string,
    input: SearchInput = {},
  ) => {
    const { limit } = page(input.pagination);
    const res = await searchIn(
      ctx,
      objectId,
      { ...input, pagination: { ...input.pagination, limit: limit + 1 } },
      true,
    );
    const list = res.records.slice(0, limit);
    const hasMore = res.records.length > limit;
    return {
      records: list,
      hasMore,
      total: res.total!,
      next: hasMore ? (list.at(-1)?.id ?? null) : null,
    };
  },

  // Aggregation (pages): groupBy + aggregate [{op, field, as}], in SQL.
  // Without `aggregate`: one count per group (`count`).
  aggregate: async (
    ctx: TenantContext,
    objectId: string,
    input: AggregateInput,
  ) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const { fields, where } = await scoped(
        tx,
        ctx,
        objectId,
        input.filter,
        input.q,
      );
      const { limit } = page(input.pagination);
      const field = (key: string) => {
        const f = fields.find((x) => x.key === key);
        if (!f)
          throw appError("objects.unknownField", "Unknown field: {field}", {
            field: key,
          });
        return f;
      };
      const keys = [input.groupBy ?? []].flat();
      // Raw jsonb value: the group key keeps its type.
      const groups = keys.map((k) => sql`${records.data}->${field(k).key}`);
      const select: Record<string, SQL> = {};
      keys.forEach((k, i) => (select[k] = groups[i]!));
      // Groups by position: the `groups` parameters do not compare.
      const ords = keys.map((_, i) => sql.raw(String(i + 1)));
      for (const a of input.aggregate ?? [{ op: "count", as: "count" }]) {
        if (a.op === "count") {
          select[a.as] = sql`count(*)`.mapWith(Number);
          continue;
        }
        if (!a.field)
          throw appError("records.fieldRequired", "{op}: field required", {
            op: a.op,
          });
        const f = field(a.field);
        const e = fieldExpr(records.data, f);
        // Stored numeric types (currency, percent, rating, autonumber included).
        const numeric = NUMERIC.includes(f.type);
        const num = a.op === "sum" || a.op === "avg" || numeric;
        if (num && !numeric)
          throw appError(
            "records.numericFieldRequired",
            "{op}: numeric field required ({field})",
            { op: a.op, field: a.field },
          );
        const agg = sql`${sql.raw(a.op)}(${e})`;
        select[a.as] = num ? agg.mapWith(Number) : agg;
      }
      return tx
        .select(select)
        .from(records)
        .where(and(eq(records.objectId, objectId), where))
        .groupBy(...ords)
        .orderBy(...ords)
        .limit(limit) as Promise<Record<string, unknown>[]>;
    });
  },
};
