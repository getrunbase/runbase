import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store";

const tick = () => new Promise((r) => setTimeout(r, 0));
const row = (id: string, stage: string) => ({
  id,
  objectId: "deals",
  data: { stage },
});

test("store: cache, live invalidation and after mutation", async () => {
  let n = 0;
  const store = createStore(async (m) =>
    m === "query" ? (n++, { rows: [row("a", "x")], total: 1 }) : {},
  );
  const args = { object: "deals" };
  const off = store.subscribe("query", args, () => {});
  store.subscribe("query", args, () => {});
  await tick();
  assert.equal(n, 1, "deduplicated");
  store.invalidate(["autre"]);
  await tick();
  assert.equal(n, 1, "unrelated object");
  store.invalidate(["deals"]);
  await tick();
  assert.equal(n, 2, "reloaded on changed");
  await store.mutate("update", { id: "a", patch: { stage: "y" } });
  await tick();
  assert.equal(n, 3, "reloaded after mutation");
  off();
});

test("store: optimistic then rollback if the server refuses", async () => {
  let fail = false;
  const store = createStore(async (m) => {
    if (m === "query") return { rows: [row("a", "x")], total: 1 };
    await tick();
    if (fail) throw new Error("refused");
    return {};
  });
  const key = 'query:{"object":"deals"}';
  store.subscribe("query", { object: "deals" }, () => {});
  await tick();
  fail = true;
  const p = store.mutate("update", { id: "a", patch: { stage: "y" } });
  const stage = () =>
    (store.get(key)!.data as { rows: { data: { stage: string } }[] }).rows[0]!
      .data.stage;
  assert.equal(stage(), "y", "applied immediately");
  await assert.rejects(p, /refused/);
  assert.equal(stage(), "x", "rolled back");
  const d = store.mutate("delete", { id: "a" });
  assert.equal((store.get(key)!.data as { total: number }).total, 0);
  await assert.rejects(d);
  assert.equal((store.get(key)!.data as { total: number }).total, 1);
});

test("store: optimistic creation outside filtered lists, failure reread from server, tmp ids refused", async () => {
  const fail = true;
  const store = createStore(async (m, a) => {
    if (m === "create" && fail) throw new Error("refused");
    const f = (a as { filter?: unknown }).filter;
    return { rows: f ? [] : [row("a", "x")], total: f ? 0 : 1 };
  });
  const all = { object: "deals" };
  const won = {
    object: "deals",
    filter: { field: "stage", op: "eq", value: "won" },
  };
  store.subscribe("query", all, () => {});
  store.subscribe("query", won, () => {});
  await tick();
  const p = store.mutate("create", { object: "deals", data: { stage: "x" } });
  const rows = (k: object) =>
    (store.get(`query:${JSON.stringify(k)}`)!.data as { rows: unknown[] }).rows;
  assert.equal(rows(all).length, 2, "ligne optimiste");
  assert.equal(rows(won).length, 0, "not in the filtered list");
  await assert.rejects(p);
  await tick();
  assert.equal(rows(all).length, 1, "rolled back and reread");
  await assert.rejects(store.mutate("update", { id: "tmp-1", patch: {} }));
});

test("store: useInfiniteQuery keyset (after = next), reread live", async () => {
  const all = ["a", "b", "c", "d", "e"].map((id) => row(id, "x"));
  const seen: unknown[] = [];
  const store = createStore(async (m, a) => {
    const { after, limit = 2 } = a as { after?: string; limit?: number };
    seen.push(after);
    const from = after ? all.findIndex((r) => r.id === after) + 1 : 0;
    const rows = all.slice(from, from + limit);
    const next = rows.length === limit ? rows.at(-1)!.id : null;
    return { rows, total: all.length, next };
  });
  const args = { object: "deals", limit: 2 };
  const key = `infinite:${JSON.stringify(args)}`;
  store.subscribe("infinite", args, () => {});
  await tick();
  const ids = () =>
    (store.get(key)!.data as { rows: { id: string }[] }).rows.map((r) => r.id);
  assert.deepEqual(ids(), ["a", "b"]);
  store.more(key);
  await tick();
  store.more(key);
  await tick();
  assert.deepEqual(ids(), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(seen, [undefined, "b", "d"]);
  store.more(key); // plus de page : aucun appel
  assert.equal(seen.length, 3);
  store.invalidate(["deals"]);
  await tick();
  assert.deepEqual(ids(), ["a", "b"], "invalidation : 1re page relue");
});

test("store: useAggregate invalidated by its own object only", async () => {
  let n = 0;
  const store = createStore(
    async () => (n++, { rows: [{ count: n }], total: 1 }),
  );
  store.subscribe("aggregate", { object: "deals", aggregate: [] }, () => {});
  await tick();
  store.invalidate(["autre"]);
  await tick();
  assert.equal(n, 1);
  store.invalidate(["deals"]);
  await tick();
  assert.equal(n, 2);
});
