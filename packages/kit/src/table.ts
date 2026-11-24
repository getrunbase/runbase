// Pure table logic (port of apps/web/app/pages/table.ts): typed columns
// (or derived from the object schema), formatting, search, sorting,
// client-side pagination. Formatting through Intl (locale provided by the page).
export type Row = Record<string, unknown>;

// Default header: `data.last_contact` -> `Last contact`.
export const header = (k: string) => {
  const s = (k.split(".").pop() ?? k).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export type Col = {
  key: string;
  label: string;
  type: string;
  format?: string;
  // Badge: raw value -> {label, variant}.
  map?: Record<string, { label?: string; variant?: string }>;
  editable?: boolean;
};

// Object field (schema) as returned by useObject.
export type Field = {
  key: string;
  label?: string;
  type: string;
  options?: string[];
  required?: boolean;
  object?: string;
  currency?: string;
  pattern?: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
};

// Lenient boolean: sql queries return "true"/"false" as text.
export const truthy = (v: unknown) =>
  v === true || v === "true" || v === 1 || v === "1";

// Numeric columns: right-aligned.
export const numeric = (c: Col) => c.type === "currency" || c.type === "number";

const str = (v: unknown) => (v == null ? "" : String(v));

// Field by path (`data.stage`): records store their fields under `data`.
export const at = (row: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o as Row | undefined)?.[k], row);

// Columns: strings or {key, label, type, format}; default = keys of `sample`.
export function columnsOf(columns: unknown, sample: unknown): Col[] {
  const raw = Array.isArray(columns)
    ? columns
    : Object.keys((sample as Row | undefined) ?? {});
  return raw.map((c) => {
    if (c && typeof c === "object") {
      const o = c as Row;
      const key = str(o.key);
      return {
        key,
        label: o.label != null ? str(o.label) : header(key),
        type: str(o.type || "text"),
        ...(o.format != null && { format: str(o.format) }),
        ...(typeof o.map === "object" && o.map && { map: o.map as Col["map"] }),
        ...(o.editable === true && { editable: true }),
      };
    }
    return { key: str(c), label: header(str(c)), type: "text" };
  });
}

const COL_TYPE: Record<string, string> = {
  number: "number",
  percent: "number",
  rating: "number",
  currency: "currency",
  date: "date",
  bool: "boolean",
  select: "badge",
};
const HIDDEN = new Set(["json", "file", "refs"]);

// Columns derived from the object schema: one field = `data.<key>`.
export const columnsFromFields = (fields: Field[], only?: string[]): Col[] =>
  (only?.length
    ? only
        .map((k) => fields.find((f) => f.key === k))
        .filter((f): f is Field => !!f)
    : fields.filter((f) => !HIDDEN.has(f.type))
  ).map((f) => ({
    key: `data.${f.key}`,
    label: f.label ?? header(f.key),
    type: COL_TYPE[f.type] ?? "text",
    ...(f.type === "currency" && { format: f.currency ?? "EUR" }),
  }));

// Translated labels of a boolean (yes, no), provided by the caller.
export type YesNo = readonly [yes: string, no: string];
export type FormatOpts = { yesNo?: YesNo; locale?: string };

function date(v: unknown, f: string | undefined, locale?: string) {
  const d = new Date(str(v));
  if (Number.isNaN(d.getTime())) return str(v);
  // Date only (YYYY-MM-DD): no time zone shift.
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    ...(f === "datetime" && { timeStyle: "short" }),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(str(v)) && { timeZone: "UTC" }),
  }).format(d);
}

// Displayed text of a value depending on the column type.
export function cellText(v: unknown, col: Col, o: FormatOpts = {}): string {
  if (v == null || v === "") return "";
  const f = col.format;
  const n = Number(v);
  switch (col.type) {
    case "date":
      return date(v, f, o.locale);
    case "currency":
      return Number.isNaN(n)
        ? str(v)
        : new Intl.NumberFormat(o.locale, {
            style: "currency",
            currency: f || "EUR",
          }).format(n);
    case "number":
      return Number.isNaN(n)
        ? str(v)
        : new Intl.NumberFormat(
            o.locale,
            f !== undefined && /^\d+$/.test(f)
              ? { minimumFractionDigits: +f, maximumFractionDigits: +f }
              : {},
          ).format(n);
    case "boolean":
      return truthy(v)
        ? (o.yesNo?.[0] ?? "true")
        : (o.yesNo?.[1] ?? "false");
    case "badge":
      return col.map?.[str(v)]?.label ?? str(v);
    default:
      return Array.isArray(v) ? v.map(str).join(", ") : str(v);
  }
}

// Sort comparison: numbers and dates by value, otherwise text, empty values last.
function compare(a: unknown, b: unknown): number {
  if (a == null || a === "") return b == null || b === "" ? 0 : 1;
  if (b == null || b === "") return -1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return str(a).localeCompare(str(b), undefined, { numeric: true });
}

export type SortState = { key: string; dir: "asc" | "desc" } | null;
export type View = FormatOpts & {
  query?: string;
  sort?: SortState;
  page?: number;
  pageSize?: number;
};

// Visible rows: search (on the column text), sort, then page.
export function tableView(rows: Row[], cols: Col[], v: View) {
  const q = (v.query ?? "").trim().toLowerCase();
  let out = q
    ? rows.filter((r) =>
        cols.some((c) => cellText(at(r, c.key), c, v).toLowerCase().includes(q)),
      )
    : rows;
  const s = v.sort;
  if (s) {
    const sign = s.dir === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => sign * compare(at(a, s.key), at(b, s.key)));
  }
  const total = out.length;
  const size = v.pageSize && v.pageSize > 0 ? v.pageSize : 0;
  const pages = size ? Math.max(1, Math.ceil(total / size)) : 1;
  const page = Math.min(Math.max(0, v.page ?? 0), pages - 1);
  return {
    rows: size ? out.slice(page * size, page * size + size) : out,
    total,
    pages,
    page,
  };
}

// Header click: asc, then desc, then no sort.
export function nextSort(sort: SortState | undefined, key: string): SortState {
  if (sort?.key !== key) return { key, dir: "asc" };
  return sort.dir === "asc" ? { key, dir: "desc" } : null;
}

// Sort "key:asc|desc" (or "-key") carried by URL state.
export function parseSort(v: unknown): SortState {
  const s = str(v).trim();
  if (!s) return null;
  const [key = "", dir] = s.startsWith("-")
    ? [s.slice(1), "desc"]
    : s.split(":");
  return key ? { key, dir: dir === "desc" ? "desc" : "asc" } : null;
}

// Server sort (useQuery): `data.amount` -> {field: "amount"}.
export const toQuerySort = (s: SortState) =>
  s ? [{ field: s.key.replace(/^data\./, ""), dir: s.dir }] : undefined;

// Initials of a name (avatar without image).
export const initials = (v: unknown) =>
  str(v)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

// Record label: title field, otherwise name/title, otherwise id.
export const titleOf = (r: Row, field?: string) =>
  str(
    at(r, `data.${field ?? "name"}`) ??
      at(r, "data.title") ??
      at(r, "data.name") ??
      r.id,
  );
