// Cache of the runtime SDK reads: one entry per call (method + args),
// read by useSyncExternalStore, deduplicated, reloaded when its objects
// change (live or mutation). Optimistic mutations: patch applied to the
// entries that contain the record, rolled back if the server refuses.
// `infinite` (useInfiniteQuery): accumulated keyset `query` pages (`more`).
export type Call = (method: string, args: unknown) => Promise<unknown>;
export type Snap = { data?: unknown; error?: string; loading: boolean };

type Row = { id?: unknown; objectId?: unknown; data?: Record<string, unknown> };
type Entry = {
  method: string;
  args: Record<string, unknown>;
  snap: Snap;
  subs: Set<() => void>;
  seq: number;
};

export const keyOf = (method: string, args: unknown) =>
  `${method}:${JSON.stringify(args ?? {})}`;

export function createStore(call: Call) {
  const entries = new Map<string, Entry>();
  const set = (e: Entry, snap: Snap) => {
    e.snap = snap;
    e.subs.forEach((f) => f());
  };
  const load = (e: Entry) => {
    const seq = ++e.seq;
    set(e, { ...e.snap, loading: true });
    call(e.method === "infinite" ? "query" : e.method, e.args).then(
      (data) => seq === e.seq && set(e, { data, loading: false }),
      (x: Error) =>
        seq === e.seq &&
        set(e, { data: e.snap.data, error: x.message, loading: false }),
    );
  };
  // Does the entry depend on these objects? (record and timeline, cheap,
  // follow every change: refs and events have no single object)
  const touches = (e: Entry, objects: string[] | "*") =>
    objects === "*" ||
    e.method === "record" ||
    e.method === "timeline" ||
    (["query", "aggregate", "infinite"].includes(e.method) &&
      objects.includes(String(e.args.object)));
  const invalidate = (objects: string[] | "*") => {
    for (const [k, e] of entries)
      if (!e.subs.size) entries.delete(k);
      else if (touches(e, objects)) load(e);
  };

  // Applies `fn` to the cached data; returns the rollback.
  const patchAll = (
    fn: (method: string, args: Entry["args"], d: unknown) => unknown,
  ) => {
    const undo: [Entry, Snap, number][] = [];
    for (const e of entries.values()) {
      const next = fn(e.method, e.args, e.snap.data);
      if (next === e.snap.data) continue;
      undo.push([e, e.snap, e.seq]);
      set(e, { ...e.snap, data: next });
    }
    // Rollback: old snapshot only if no reload happened
    // since (otherwise it would be stale), then server reload in every case.
    return () =>
      undo.forEach(([e, s, seq]) => {
        if (e.seq === seq) set(e, s);
        load(e);
      });
  };
  const mapRows = (d: unknown, f: (rows: Row[]) => Row[]) => {
    const q = d as { rows: Row[]; total?: number };
    const rows = f(q.rows);
    return rows === q.rows
      ? d
      : { ...q, rows, total: (q.total ?? 0) + rows.length - q.rows.length };
  };
  const optimistic = (
    kind: "create" | "update" | "delete",
    args: Record<string, unknown>,
  ) =>
    patchAll((method, a, d) => {
      if (!d) return d;
      if (method === "record") {
        const r = d as Row;
        if (r.id !== args.id) return d;
        return kind === "update"
          ? { ...r, data: { ...r.data, ...(args.patch as object) } }
          : d;
      }
      if (
        (method !== "query" && method !== "infinite") ||
        a.groupBy ||
        a.aggregate
      )
        return d;
      // Creation: only in lists without filter or search (the
      // row does not belong in every column of a kanban).
      if (kind === "create")
        return a.object === args.object && !a.filter && !a.q
          ? mapRows(d, (rows) => [
              ...rows,
              {
                id: `tmp-${Date.now()}`,
                objectId: args.object,
                data: args.data as Row["data"],
              },
            ])
          : d;
      return mapRows(d, (rows) =>
        rows.some((r) => r.id === args.id)
          ? kind === "delete"
            ? rows.filter((r) => r.id !== args.id)
            : rows.map((r) =>
                r.id === args.id
                  ? { ...r, data: { ...r.data, ...(args.patch as object) } }
                  : r,
              )
          : rows,
      );
    });

  return {
    get: (key: string) => entries.get(key)?.snap,
    subscribe(method: string, args: Record<string, unknown>, fn: () => void) {
      const key = keyOf(method, args);
      let e = entries.get(key);
      if (!e) {
        e = { method, args, snap: { loading: true }, subs: new Set(), seq: 0 };
        entries.set(key, e);
        load(e);
      }
      e.subs.add(fn);
      const entry = e;
      return () => entry.subs.delete(fn);
    },
    reload: (key: string) => {
      const e = entries.get(key);
      if (e) load(e);
    },
    invalidate,
    // Next page of an `infinite` entry: `after = next`.
    more(key: string) {
      const e = entries.get(key);
      const d = e?.snap.data as
        { rows: Row[]; total: number; next?: string | null } | undefined;
      if (!e || !d?.next || e.snap.loading) return;
      const seq = ++e.seq;
      set(e, { ...e.snap, loading: true });
      call("query", { ...e.args, after: d.next }).then(
        (p) => {
          const page = p as typeof d;
          if (seq === e.seq)
            set(e, {
              data: { ...page, rows: [...d.rows, ...page.rows] },
              loading: false,
            });
        },
        (x: Error) =>
          seq === e.seq &&
          set(e, { data: d, error: x.message, loading: false }),
      );
    },
    // Mutation: optimistic (unless `optimistic: false`), rolled back on error,
    // then reload of the object's entries.
    async mutate(
      kind: "create" | "update" | "delete",
      args: Record<string, unknown>,
      opts: { optimistic?: boolean } = {},
    ) {
      // Optimistic row not created yet: no server id to target.
      if (kind !== "create" && String(args.id).startsWith("tmp-"))
        throw new Error("Save in progress, try again in a moment");
      const undo =
        opts.optimistic === false ? () => {} : optimistic(kind, args);
      try {
        const out = (await call(kind, args)) as Row | undefined;
        invalidate(kind === "create" ? [String(args.object)] : "*");
        return out;
      } catch (x) {
        undo();
        throw x;
      }
    },
  };
}
export type Store = ReturnType<typeof createStore>;
