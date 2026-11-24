import type { Filter } from "@runbase/core/filter";
import {
  baseType,
  type BaseType,
  type Field,
} from "@runbase/core/objects/fields";

// Records table view: "pill" filters translated to the core filter
// DSL (same operators as workflow conditions).
export type Pill = { field: string; op: string; value: string };

const empties = ["is_empty", "is_not_empty"];
const OPS_BY_TYPE: Record<BaseType, string[]> = {
  text: [
    "contains",
    "eq",
    "neq",
    "starts_with",
    "ends_with",
    "regex",
    ...empties,
  ],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", ...empties],
  date: ["before", "after", "within", "older_than", ...empties],
  select: ["eq", "neq", "not_in", ...empties],
  multi_select: ["contains", ...empties],
  bool: ["is", ...empties],
  json: [...empties],
  ref: ["eq", ...empties],
  refs: ["contains", ...empties],
  file: empties,
  virtual: [],
};
// Operators offered for a field (lookup / rollup: not filterable).
export const opsFor = (f: Field) => OPS_BY_TYPE[baseType(f)];

// Operator label: `objects.ops.<op>` key translated at render time.
export type Op =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "regex"
  | "not_in"
  | "before"
  | "after"
  | "within"
  | "older_than"
  | "is"
  | "is_empty"
  | "is_not_empty";

export const needsValue = (op: string) => !empties.includes(op);

// Text input -> typed field value; undefined if invalid or empty.
export function parseValue(f: Field, raw: string, op?: string): unknown {
  const s = raw.trim();
  if (op === "within" || op === "older_than") {
    const n = Number(s);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }
  if (s === "") return undefined;
  if (op === "not_in") return [s];
  switch (baseType(f)) {
    case "number": {
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    }
    case "bool":
      return s === "true";
    case "json":
      try {
        return JSON.parse(s);
      } catch {
        return undefined;
      }
    default:
      return s;
  }
}

// Complete pills -> `all` filter; incomplete pills are ignored.
export function pillsToFilter(
  fields: Field[],
  pills: Pill[],
): Filter | undefined {
  const all = pills.flatMap((p): Filter[] => {
    const f = fields.find((x) => x.key === p.field);
    if (!f) return [];
    if (!needsValue(p.op)) return [{ field: p.field, op: p.op } as Filter];
    const value = parseValue(f, p.value, p.op);
    return value === undefined
      ? []
      : [{ field: p.field, op: p.op, value } as Filter];
  });
  return all.length ? { all } : undefined;
}

// Locale-aware formatting (next-intl useFormatter / getFormatter) and
// translated yes/no labels.
export type CellFormat = {
  number: (v: number, o?: { style: "currency"; currency: string }) => string;
  dateTime: (d: Date, o?: { dateStyle: "short"; timeStyle: "short" }) => string;
  yes: string;
  no: string;
};
const plain: CellFormat = {
  number: (v, o) => new Intl.NumberFormat(undefined, o).format(v),
  dateTime: (d, o) => new Intl.DateTimeFormat(undefined, o).format(d),
  yes: "true",
  no: "false",
};

// Cell display, by field type when known.
export function display(
  v: unknown,
  f?: Field,
  fmt: CellFormat = plain,
): string {
  if (v == null || v === "") return "";
  if (f?.type === "currency" && typeof v === "number")
    return fmt.number(v, { style: "currency", currency: f.currency ?? "EUR" });
  if (f?.type === "percent" && typeof v === "number")
    return `${fmt.number(v)} %`;
  if (
    (f?.type === "created_at" || f?.type === "updated_at") &&
    typeof v === "string"
  )
    return fmt.dateTime(new Date(v), {
      dateStyle: "short",
      timeStyle: "short",
    });
  if (f?.type === "file" && Array.isArray(v))
    return v.map((x) => (x as { name?: string }).name ?? "").join(", ");
  if (f?.type === "bool" || typeof v === "boolean") return v ? fmt.yes : fmt.no;
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Saved view filter -> pills, if it is a plain `all` list of
// conditions on direct fields; otherwise null (filter kept as is).
export function filterToPills(fields: Field[], filter: unknown): Pill[] | null {
  if (!filter) return [];
  const list =
    typeof filter === "object" && "all" in filter
      ? (filter as { all: unknown[] }).all
      : [filter];
  const pills: Pill[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object" || !("field" in c)) return null;
    const { field, op, value } = c as {
      field: string;
      op: string;
      value?: unknown;
    };
    if (!fields.some((f) => f.key === field)) return null;
    const v = Array.isArray(value) ? value : value === undefined ? [] : [value];
    if (v.length > 1) return null;
    pills.push({ field, op, value: v.length ? String(v[0]) : "" });
  }
  return pills;
}
