// Filter DSL, shared with the condition block.
// A filter is an `all` / `any` tree of conditions { field, op, value },
// compiled into parameterized SQL on the JSONB `data` column: keys and values
// always go as parameters, never concatenated.
import { appError as baseError, type ErrorParams } from "../errors/app-error";
import { isDeepStrictEqual } from "node:util";
import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { records } from "../db/schema";

// Every filter error is caused by the caller's filter: `invalid_input`.
const appError = (code: string, template: string, params?: ErrorParams) =>
  baseError(code, template, params, { kind: "invalid_input" });
import {
  baseType,
  fieldsSchema,
  type BaseType,
  type Field,
} from "../objects/fields";

export const conditionSchema = z.strictObject({
  field: z.string().min(1),
  op: z.enum([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "not_in",
    "contains",
    "starts_with",
    "ends_with",
    "regex",
    "between",
    "before",
    "after",
    "older_than",
    "within",
    "is",
    "is_empty",
    "is_not_empty",
  ]),
  // Scalar, list (in / multi_select) or JSON value (json fields).
  value: z.json().optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export type Filter = Condition | { all: Filter[] } | { any: Filter[] };

export const filterSchema: z.ZodType<Filter> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(filterSchema) }),
    z.strictObject({ any: z.array(filterSchema) }),
    conditionSchema,
  ]),
);

type Op = Condition["op"];
const empties: Op[] = ["is_empty", "is_not_empty"];
// Allow list of operators per base type (baseType) of the field.
const texts: Op[] = [
  "eq",
  "neq",
  "contains",
  "starts_with",
  "ends_with",
  "regex",
  "in",
  "not_in",
  ...empties,
];
export const allowed: Record<BaseType, Op[]> = {
  text: texts,
  number: [
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "in",
    "not_in",
    ...empties,
  ],
  date: [
    "before",
    "after",
    "older_than",
    "within",
    "eq",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    ...empties,
  ],
  select: ["eq", "neq", "in", "not_in", ...empties],
  multi_select: ["eq", "neq", "contains", "in", "not_in", ...empties],
  bool: ["is", "eq", ...empties],
  json: ["eq", "neq", "contains", "in", "not_in", ...empties],
  ref: ["eq", "neq", "in", "not_in", ...empties],
  refs: ["contains", "in", "not_in", ...empties],
  file: empties,
  // lookup / rollup: computed on read, not filterable in SQL.
  virtual: [],
};

// Operators per field type, for tool descriptions (agents).
export const operatorsDoc =
  [
    "text/email/url/phone: " + texts.join(", "),
    "number/currency/percent/rating: " + allowed.number.join(", "),
    "date/datetime: " + allowed.date.join(", "),
    "select: " + allowed.select.join(", "),
    "multi_select: " + allowed.multi_select.join(", "),
    "bool: " + allowed.bool.join(", "),
    "ref: " + allowed.ref.join(", "),
    "refs: " + allowed.refs.join(", "),
  ].join("; ") +
  ". between takes [low, high] (inclusive): numbers, or ISO dates for date fields. older_than/within take a number of days. regex is case-sensitive POSIX (PostgreSQL ~), not JavaScript.";

function scalar(f: Field): z.ZodType {
  if (f.type === "select" || f.type === "multi_select") {
    const e = z.enum(f.options);
    return f.type === "select" ? e : e.or(z.array(e));
  }
  switch (baseType(f)) {
    case "number":
      return z.number();
    case "bool":
      return z.boolean();
    case "date":
      return z.iso.date().or(z.iso.datetime());
    case "json":
      return z.json();
    case "ref":
    case "refs":
      return z.uuid();
    default:
      return z.string();
  }
}

function valueSchema(f: Field, op: Op): z.ZodType {
  if (empties.includes(op)) return z.undefined();
  if (op === "between")
    return baseType(f) === "date"
      ? z.tuple([scalar(f), scalar(f)])
      : z.tuple([z.number(), z.number()]);
  // Durations in days.
  if (op === "older_than" || op === "within")
    return z.number().int().positive();
  if (op === "in" || op === "not_in") return z.array(scalar(f)).min(1);
  if (op === "regex")
    return z.string().refine((p) => {
      try {
        new RegExp(p);
        return true;
      } catch {
        return false;
      }
    }, "Invalid regular expression");
  return scalar(f);
}

// Schemas of the workspace objects by slug: `self` is the filtered
// object, `a.b.c` paths navigate through refs, refs and inverse relations.
export type SchemaGraph = {
  self: string;
  objects: Record<string, { id: string; fields: Field[] }>;
};

export function schemaGraph(
  self: string,
  rows: { id: string; slug: string; fields: unknown }[],
): SchemaGraph {
  return {
    self,
    objects: Object.fromEntries(
      rows.map((o) => [
        o.slug,
        { id: o.id, fields: fieldsSchema.parse(o.fields) },
      ]),
    ),
  };
}

// Relation hop: ref (one), refs (several) or inverse (records of another
// object whose `key` field points to the current record, without storage).
export type Hop = {
  kind: "ref" | "refs" | "inverse";
  key: string;
  many: boolean;
  objectId: string;
};

// Inverse segment: `<source object slug>` or `<slug>:<field>` if ambiguous.
function hopFrom(
  fields: Field[],
  self: string | undefined,
  graph: SchemaGraph | undefined,
  seg: string,
): { hop: Hop; slug: string; fields: Field[] } | null {
  if (!graph) return null;
  const f = fields.find((x) => x.key === seg);
  if (f) {
    if (f.type !== "ref" && f.type !== "refs") return null;
    const t = graph.objects[f.object];
    if (!t) return null;
    return {
      hop: {
        kind: f.type,
        key: f.key,
        many: f.type === "refs",
        objectId: t.id,
      },
      slug: f.object,
      fields: t.fields,
    };
  }
  const [slug, key] = seg.split(":", 2) as [string, string?];
  const src = graph.objects[slug];
  if (!src || self === undefined) return null;
  const fks = src.fields.filter(
    (x) =>
      (x.type === "ref" || x.type === "refs") &&
      x.object === self &&
      (key === undefined || x.key === key),
  );
  if (fks.length !== 1) return null;
  const fk = fks[0]!;
  return {
    hop: {
      kind: "inverse",
      key: fk.key,
      many: fk.type === "refs",
      objectId: src.id,
    },
    slug,
    fields: src.fields,
  };
}

// Relation path alone (`include` option of records.get).
export function resolveRelation(
  fields: Field[],
  graph: SchemaGraph,
  path: string,
): Hop[] {
  const hops: Hop[] = [];
  let cur = { fields, slug: graph.self };
  for (const seg of path.split(".")) {
    const h = hopFrom(cur.fields, cur.slug, graph, seg);
    if (!h)
      throw appError("filter.unknownRelation", "Unknown relation: {path}", {
        path,
      });
    hops.push(h.hop);
    cur = h;
  }
  return hops;
}

// System column `id` filterable (eq, neq, in) when no field is called id.
const ID: Field = { key: "id", label: "id", type: "ref", object: "" };

function resolve(
  fields: Field[],
  graph: SchemaGraph | undefined,
  path: string,
) {
  // `data.` prefix (record path) tolerated, as for sorting, unless a
  // field or relation is called `data`.
  const segs = path.split(".");
  if (
    segs.length > 1 &&
    segs[0] === "data" &&
    !fields.some((f) => f.key === "data")
  )
    segs.shift();
  const hops: Hop[] = [];
  let cur = { fields, slug: graph?.self };
  for (const seg of segs.slice(0, -1)) {
    const h = hopFrom(cur.fields, cur.slug, graph, seg);
    if (!h)
      throw appError("objects.unknownField", "Unknown field: {field}", {
        field: path,
      });
    hops.push(h.hop);
    cur = h;
  }
  const field =
    cur.fields.find((x) => x.key === segs.at(-1)) ??
    (segs.at(-1) === "id" ? ID : undefined);
  if (!field)
    throw appError("objects.unknownField", "Unknown field: {field}", {
      field: path,
    });
  return { hops, field };
}

// Resolves each condition to its typed field (paths through `graph`) and checks
// operator and value. Unknown field or incompatible type = error.
export function validateFilter(
  fields: Field[],
  filter: unknown,
  graph?: SchemaGraph,
): Filter {
  const parsed = filterSchema.parse(filter);
  const walk = (n: Filter): void => {
    if ("all" in n) return n.all.forEach(walk);
    if ("any" in n) return n.any.forEach(walk);
    const { field: f } = resolve(fields, graph, n.field);
    if (!allowed[baseType(f)].includes(n.op))
      throw appError(
        "filter.invalidOperatorField",
        "Invalid operator {op} for {field} ({type})",
        { op: n.op, field: n.field, type: f.type },
      );
    if (
      (n.op === "older_than" || n.op === "within") &&
      !valueSchema(f, n.op).safeParse(n.value).success
    )
      throw appError(
        "filter.invalidDays",
        "{field} {op}: expected integer number of days, got {value}",
        {
          field: n.field,
          op: n.op,
          value: JSON.stringify(n.value) ?? "undefined",
        },
      );
    if (n.op === "regex" && !valueSchema(f, n.op).safeParse(n.value).success)
      throw appError(
        "filter.invalidRegex",
        "{field} regex: invalid pattern {pattern} (POSIX syntax, as PostgreSQL ~; case-sensitive)",
        { field: n.field, pattern: JSON.stringify(n.value) ?? "undefined" },
      );
    if (!valueSchema(f, n.op).safeParse(n.value).success)
      throw appError(
        "filter.incompatibleValue",
        "Incompatible value for {field} {op}",
        { field: n.field, op: n.op },
      );
  };
  walk(parsed);
  return parsed;
}

// In-memory evaluation of direct fields: interpreter, no eval.
// Relation paths are evaluated in SQL (recordsService.matches).
type Data = Record<string, unknown>;
export function evaluateFilter(
  fields: Field[],
  filter: unknown,
  data: Data,
  now = new Date(),
): boolean {
  const walk = (n: Filter): boolean => {
    if ("all" in n) return n.all.every(walk);
    if ("any" in n) return n.any.some(walk);
    const r = resolve(fields, undefined, n.field);
    return evalCondition(r.field, n, data[r.field.key], now);
  };
  return walk(validateFilter(fields, filter));
}

// Evaluates a condition on any run value (value mode of
// condition and switch, A5): type inferred from the value and the operator.
export function evaluateValue(
  op: Condition["op"],
  raw: unknown,
  value?: unknown,
  now = new Date(),
): boolean {
  const type = ["before", "after", "older_than", "within"].includes(op)
    ? "date"
    : Array.isArray(raw)
      ? "multi_select"
      : raw !== null && typeof raw === "object"
        ? "json"
        : typeof raw === "number" ||
            ["gt", "gte", "lt", "lte", "between"].includes(op)
          ? "number"
          : typeof raw === "boolean"
            ? "bool"
            : "text";
  const f = { key: "value", label: "value", type } as Field;
  return evalCondition(f, { field: "value", op, value } as Condition, raw, now);
}

const DAY = 86_400_000;
function evalCondition(f: Field, c: Condition, raw: unknown, now: Date) {
  const empty =
    raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0);
  if (c.op === "is_empty") return empty;
  if (c.op === "is_not_empty") return !empty;
  if (empty) return c.op === "neq" || c.op === "not_in";
  const values = Array.isArray(c.value) ? c.value : [c.value];
  const b = baseType(f);
  if (b === "multi_select" || b === "refs" || b === "json") {
    const has = (v: unknown) =>
      b !== "json" ? (raw as unknown[]).includes(v) : isDeepStrictEqual(raw, v);
    if (c.op === "in") return values.some(has);
    if (c.op === "not_in") return !values.some(has);
    if (c.op === "neq") return !values.every(has);
    return values.every(has);
  }
  const num = (x: unknown) =>
    b === "date" ? Date.parse(String(x)) : Number(x);
  const a = num(raw);
  const v = c.value;
  switch (c.op) {
    case "eq":
    case "is":
      return b === "date" ? a === num(v) : raw === v;
    case "neq":
      return raw !== v;
    case "in":
      return (values as unknown[]).includes(raw);
    case "not_in":
      return !(values as unknown[]).includes(raw);
    case "gt":
    case "after":
      return a > num(v);
    case "gte":
      return a >= num(v);
    case "lt":
    case "before":
      return a < num(v);
    case "lte":
      return a <= num(v);
    case "between": {
      const [lo, hi] = v as [unknown, unknown];
      return a >= num(lo) && a <= num(hi);
    }
    case "older_than":
      return a < now.getTime() - (v as number) * DAY;
    case "within":
      return a >= now.getTime() - (v as number) * DAY && a <= now.getTime();
    case "contains":
      return String(raw).toLowerCase().includes(String(v).toLowerCase());
    case "starts_with":
      return String(raw).toLowerCase().startsWith(String(v).toLowerCase());
    case "ends_with":
      return String(raw).toLowerCase().endsWith(String(v).toLowerCase());
    case "regex":
      return new RegExp(String(v)).test(String(raw));
  }
  return false;
}

const casts: Partial<Record<BaseType, SQL>> = {
  number: sql`numeric`,
  bool: sql`boolean`,
  date: sql`timestamptz`,
};

// Typed expression of a field: `data->>key` cast according to the type.
export function fieldExpr(data: AnyColumn | SQL, f: Field): SQL {
  const text = sql`(${data}->>${f.key})`;
  const cast = casts[baseType(f)];
  return cast ? sql`${text}::${cast}` : text;
}

function param(f: Field, v: unknown): SQL {
  const cast = casts[baseType(f)];
  return cast ? sql`${v}::${cast}` : sql`${v}::text`;
}

function compileCondition(data: AnyColumn | SQL, f: Field, c: Condition): SQL {
  const raw = sql`(${data}->${f.key})`;
  const empty = sql`(${raw} is null or ${raw} = 'null'::jsonb or ${raw} = '""'::jsonb or ${raw} = '[]'::jsonb)`;
  if (c.op === "is_empty") return empty;
  if (c.op === "is_not_empty") return sql`not ${empty}`;
  if (c.value === undefined)
    throw appError("filter.valueRequired", "Value required for {op}", {
      op: c.op,
    });
  const values = Array.isArray(c.value) ? c.value : [c.value];
  const b = baseType(f);

  // Arrays (multi_select) and JSON: comparison by JSONB containment.
  if (b === "multi_select" || b === "refs" || b === "json") {
    const has = (v: unknown) =>
      sql`${raw} @> ${JSON.stringify(b !== "json" ? [v] : v)}::jsonb`;
    switch (c.op) {
      case "contains":
      case "eq":
        return sql.join(values.map(has), sql` and `);
      case "in":
        return sql`(${sql.join(values.map(has), sql` or `)})`;
      case "not_in":
        return sql`not coalesce((${sql.join(values.map(has), sql` or `)}), false)`;
      case "neq":
        return sql`not coalesce(${sql.join(values.map(has), sql` and `)}, false)`;
      default:
        throw appError(
          "filter.invalidOperator",
          "Invalid operator {op} for {type}",
          { op: c.op, type: f.type },
        );
    }
  }
  if (b === "virtual")
    throw appError(
      "filter.computedNotFilterable",
      "{field}: computed field cannot be filtered",
      { field: f.key },
    );

  const e = fieldExpr(data, f);
  const v = param(f, values[0]);
  switch (c.op) {
    case "eq":
    case "is":
      return sql`${e} = ${v}`;
    case "neq":
      return sql`${e} is distinct from ${v}`;
    case "gt":
    case "after":
      return sql`${e} > ${v}`;
    case "gte":
      return sql`${e} >= ${v}`;
    case "lt":
    case "before":
      return sql`${e} < ${v}`;
    case "lte":
      return sql`${e} <= ${v}`;
    case "in":
      return sql`${e} in (${sql.join(
        values.map((x) => param(f, x)),
        sql`, `,
      )})`;
    case "not_in":
      return sql`(${e} is null or ${e} not in (${sql.join(
        values.map((x) => param(f, x)),
        sql`, `,
      )}))`;
    case "contains":
      if (casts[b])
        throw appError(
          "filter.invalidContains",
          "contains is not valid for {type}",
          { type: f.type },
        );
      return sql`strpos(lower(${e}), lower(${String(values[0])})) > 0`;
    case "starts_with":
      return sql`strpos(lower(${e}), lower(${String(values[0])})) = 1`;
    case "ends_with":
      return sql`right(lower(${e}), length(${String(values[0])})) = lower(${String(values[0])})`;
    case "regex":
      return sql`${e} ~ ${String(values[0])}`;
    case "between":
      return sql`${e} between ${param(f, values[0])} and ${param(f, values[1])}`;
    case "older_than":
      return sql`${e} < now() - ${values[0]}::int * interval '1 day'`;
    case "within":
      return sql`(${e} >= now() - ${values[0]}::int * interval '1 day' and ${e} <= now())`;
    default:
      throw appError(
        "filter.invalidOperator",
        "Invalid operator {op} for {type}",
        { op: c.op, type: f.type },
      );
  }
}

// Condition at the end of a path: an `exists` correlated per hop, generated aliases
// (never taken from the input). Lists (refs, inverses): at least one record.
type Row = { data: AnyColumn | SQL; id: AnyColumn | SQL };
function compilePath(
  cur: Row,
  hops: Hop[],
  f: Field,
  c: Condition,
  depth = 0,
): SQL {
  const [h, ...rest] = hops;
  if (!h && f === ID) {
    const ids = Array.isArray(c.value) ? c.value : [c.value];
    if (c.op === "eq") return sql`${cur.id}::text = ${ids[0]}::text`;
    if (c.op === "neq") return sql`${cur.id}::text <> ${ids[0]}::text`;
    if (c.op === "in" && !ids.length) return sql`false`;
    if (c.op === "in")
      return sql`${cur.id}::text in (${sql.join(
        ids.map((x) => sql`${x}::text`),
        sql`, `,
      )})`;
    throw appError("filter.invalidOperatorId", "Invalid operator {op} for id", {
      op: c.op,
    });
  }
  if (!h) return compileCondition(cur.data, f, c);
  const a = sql.raw(`rel${depth}`);
  const link =
    h.kind === "ref"
      ? sql`${a}.id::text = (${cur.data}->>${h.key})`
      : h.kind === "refs"
        ? sql`(${cur.data}->${h.key}) @> jsonb_build_array(${a}.id::text)`
        : h.many
          ? sql`(${a}.data->${h.key}) @> jsonb_build_array(${cur.id}::text)`
          : sql`(${a}.data->>${h.key}) = ${cur.id}::text`;
  const next = { data: sql`${a}.data`, id: sql`${a}.id` };
  return sql`exists (select 1 from records ${a} where ${a}.object_id = ${h.objectId} and ${link} and ${compilePath(next, rest, f, c, depth + 1)})`;
}

// Compiles a validated filter against the object fields; unknown field = error.
// Paths (e.g. `contact.entreprise.taille`, `contact.name`) resolved through `graph`.
export function compileFilter(
  data: AnyColumn,
  fields: Field[],
  filter: Filter,
  graph?: SchemaGraph,
): SQL {
  const parsed = validateFilter(fields, filter, graph);
  const walk = (n: Filter): SQL => {
    if ("all" in n)
      return n.all.length
        ? sql`(${sql.join(n.all.map(walk), sql` and `)})`
        : sql`true`;
    if ("any" in n)
      return n.any.length
        ? sql`(${sql.join(n.any.map(walk), sql` or `)})`
        : sql`false`;
    const { hops, field } = resolve(fields, graph, n.field);
    return compilePath({ data, id: records.id }, hops, field, n);
  };
  return walk(parsed);
}
