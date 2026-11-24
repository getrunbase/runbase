// Mock data for code components (page.test, `mock` captures).
// `data` = {<object id>: rows[], records?: {<id>: record}, timeline?: {<recordId>:
// events[]}, objects?: {<id>: {name, fields}}, user?: {...}}. The mock SDK
// applies filter, `q` search, sort, pagination and groupBy/aggregate in
// memory. No dependency (Deno harness and capture browser).
export type MockData = Record<string, unknown>;

type Row = { id?: unknown; data?: Record<string, unknown> } & Record<
  string,
  unknown
>;
type Cond = { field?: string; op?: string; value?: unknown };
type Filter = Cond & { all?: Filter[]; any?: Filter[] };

const val = (r: Row, k: string) =>
  r.data && k in r.data ? r.data[k] : (r as Record<string, unknown>)[k];
const empty = (v: unknown) =>
  v == null || v === "" || (Array.isArray(v) && !v.length);
const cmp = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a ?? "").localeCompare(String(b ?? ""));

function test(r: Row, f: Filter | undefined): boolean {
  if (!f) return true;
  if (f.all) return f.all.every((x) => test(r, x));
  if (f.any) return f.any.some((x) => test(r, x));
  const v = val(r, String(f.field));
  const w = f.value;
  switch (f.op) {
    case "neq":
      return v !== w;
    case "in":
      return Array.isArray(w) && w.includes(v);
    case "contains":
      return Array.isArray(v)
        ? v.includes(w)
        : String(v ?? "")
            .toLowerCase()
            .includes(String(w).toLowerCase());
    case "starts_with":
      return String(v ?? "").startsWith(String(w));
    case "is_empty":
      return empty(v);
    case "is_not_empty":
      return !empty(v);
    case "gt":
    case "after":
      return cmp(v, w) > 0;
    case "gte":
      return cmp(v, w) >= 0;
    case "lt":
    case "before":
      return cmp(v, w) < 0;
    case "lte":
      return cmp(v, w) <= 0;
    default:
      return Array.isArray(v) ? v.includes(w) : v === w;
  }
}

function query(data: MockData, a: Record<string, unknown>) {
  const all = (data[String(a.object)] ?? []) as Row[];
  const q = String(a.q ?? "")
    .trim()
    .toLowerCase();
  let rows = all.filter(
    (r) =>
      test(r, a.filter as Filter) &&
      (!q ||
        Object.values(r.data ?? {}).some(
          (v) => typeof v === "string" && v.toLowerCase().includes(q),
        )),
  );
  const keys = [a.groupBy ?? []].flat() as string[];
  const aggs = a.aggregate as
    { op: string; field?: string; as: string }[] | undefined;
  if (keys.length || aggs) {
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = JSON.stringify(keys.map((x) => val(r, x) ?? null));
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const out = [...groups].map(([k, rs]) => {
      const o: Record<string, unknown> = {};
      keys.forEach((x, i) => (o[x] = (JSON.parse(k) as unknown[])[i]));
      for (const g of aggs ?? [{ op: "count", as: "count" }]) {
        const ns = rs.map((r) => Number(val(r, String(g.field)) ?? 0));
        o[g.as] =
          g.op === "count"
            ? rs.length
            : g.op === "sum"
              ? ns.reduce((x, y) => x + y, 0)
              : g.op === "avg"
                ? ns.reduce((x, y) => x + y, 0) / (ns.length || 1)
                : g.op === "min"
                  ? Math.min(...ns)
                  : Math.max(...ns);
      }
      return o;
    });
    out.sort((x, y) => cmp(x[keys[0] ?? ""], y[keys[0] ?? ""]));
    return { rows: out, total: out.length };
  }
  for (const s of [
    ...((a.sort ?? []) as { field: string; dir?: string }[]),
  ].reverse())
    rows = [...rows].sort(
      (x, y) =>
        cmp(val(x, s.field), val(y, s.field)) * (s.dir === "desc" ? -1 : 1),
    );
  const at = a.after
    ? rows.findIndex((r) => (r as { id?: unknown }).id === a.after) + 1
    : 0;
  const limit = Number(a.limit ?? 50);
  return { rows: rows.slice(at, at + limit), total: rows.length };
}

function find(data: MockData, id: unknown) {
  const direct = (data.records as Record<string, unknown> | undefined)?.[
    String(id)
  ];
  if (direct) return direct;
  for (const v of Object.values(data))
    if (Array.isArray(v)) {
      const hit = (v as Row[]).find((r) => r?.id === id);
      if (hit) return hit;
    }
  return null;
}

export function mockCall(data: MockData, method: string, args: unknown) {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (method) {
    case "query":
    case "aggregate":
      return query(data, a);
    case "record":
      return find(data, a.id);
    case "timeline":
      return (
        (data.timeline as Record<string, unknown> | undefined)?.[
          String(a.recordId)
        ] ?? []
      );
    case "object":
      return (
        (data.objects as Record<string, unknown> | undefined)?.[
          String(a.id)
        ] ?? { id: a.id, name: String(a.id), fields: [] }
      );
    case "user":
      return (
        data.user ?? {
          id: "u-1",
          name: "Camille Martin",
          email: "camille@example.com",
        }
      );
    case "create":
      return {
        simulated: true,
        id: `sim-${Math.random().toString(36).slice(2, 8)}`,
        objectId: a.object,
        data: a.data,
      };
    case "update":
      return { simulated: true, id: a.id, data: a.patch };
    default:
      return { simulated: true };
  }
}
