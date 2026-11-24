// List blocks: filter and transform a list of records
// (output of `record.search`, `record.get` relation + include, a step output).
import { z } from "zod";
import { defineBlock } from "../block";
import { render } from "../render";
import type { Filter } from "../../filter";
import { validateCondition } from "./condition";
import { readPath } from "./record-map";
import { at } from "./data";
import { env } from "../../env";
import { appError } from "../../errors/app-error";

// Maximum size of a processed list (cost): LIST_MAX_ITEMS, 1000 by default.
export const LIST_MAX = env().LIST_MAX_ITEMS;

// Missing (relation not loaded, record not found): empty list.
const items = z.array(z.unknown()).default([]);
const limit = z.number().int().min(1).max(LIST_MAX).default(100);
const idOf = (item: unknown) => {
  const id = (item as { id?: unknown } | null)?.id;
  if (typeof id !== "string") throw appError("blocks.itemWithoutId", "Item without a record id");
  return id;
};

// Keeps the records that match the condition (same DSL as `condition`,
// relation paths included).
export const listFilter = defineBlock({
  type: "list.filter",
  label: "Filter a list",
  description: "Keeps the records of a list that match a condition.",
  sideEffect: false,
  inputSchema: z.object({
    object: z.string().min(1),
    items,
    condition: z.unknown(),
    limit,
  }),
  outputSchema: z.object({ items, truncated: z.boolean() }),
  branches: ["ok"],
  run: async ({ object, items, condition, limit }, { services }) => {
    await validateCondition(services.objects.list, { object, condition });
    const kept = [];
    for (const item of items.slice(0, limit))
      if (await services.records.matches(idOf(item), condition as Filter))
        kept.push(item);
    return {
      branch: "ok",
      output: { items: kept, truncated: items.length > limit },
    };
  },
});

const expr = z.union([
  z.strictObject({ path: z.string().min(1) }),
  z.strictObject({ value: z.unknown() }),
]);

// Turns each element into an object: key <- `{ path }` (field or relation
// path of the record, e.g. `entreprise.nom`) or `{ value }` (template rendered
// per element with `{{item}}` and `{{index}}`).
export const listMap = defineBlock({
  type: "list.map",
  label: "Transform a list",
  description: "Turns each item of a list into an object.",
  sideEffect: false,
  inputSchema: z.object({
    items,
    mapping: z.record(z.string(), expr),
    limit,
  }),
  outputSchema: z.object({ items, truncated: z.boolean() }),
  branches: ["ok"],
  raw: ["mapping"],
  run: async ({ items, mapping, limit }, { services }) => {
    const out = [];
    for (const [index, item] of items.slice(0, limit).entries()) {
      const obj: Record<string, unknown> = {};
      for (const [k, e] of Object.entries(mapping))
        obj[k] =
          "value" in e
            ? render(e.value, { item, index })
            : await readPath(services.records, idOf(item), e.path);
      out.push(obj);
    }
    return {
      branch: "ok",
      output: { items: out, truncated: items.length > limit },
    };
  },
});

// Path inside an element (`data.montant`, `id`); empty = the element.
const path = z.string().optional();
const key = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

// Aggregates a list: count, sum, average, min, max of a value, in total
// or per group (`groupBy`).
export const listAggregate = defineBlock({
  type: "list.aggregate",
  label: "Compute on a list",
  description:
    "Counts items or computes a sum, average, minimum or maximum, overall or per group.",
  sideEffect: false,
  inputSchema: z.object({
    items,
    op: z.enum(["count", "sum", "avg", "min", "max"]),
    path,
    groupBy: z.string().optional(),
  }),
  outputSchema: z.object({
    value: z.number().nullable(),
    groups: z
      .array(z.object({ key: z.string(), value: z.number().nullable() }))
      .optional(),
  }),
  branches: ["ok"],
  run: async ({ items, op, path, groupBy }) => {
    const calc = (list: unknown[]) => {
      if (op === "count") return list.length;
      const nums = list
        .map((i) => Number(at(i, path)))
        .filter((n) => Number.isFinite(n));
      if (!nums.length) return op === "sum" ? 0 : null;
      if (op === "sum") return nums.reduce((a, b) => a + b, 0);
      if (op === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
      return op === "min" ? Math.min(...nums) : Math.max(...nums);
    };
    const value = calc(items);
    if (!groupBy) return { branch: "ok", output: { value } };
    const by = new Map<string, unknown[]>();
    for (const i of items) {
      const k = key(at(i, groupBy) ?? null);
      by.set(k, [...(by.get(k) ?? []), i]);
    }
    const groups = [...by].map(([key, list]) => ({ key, value: calc(list) }));
    return { branch: "ok", output: { value, groups } };
  },
});

// Removes duplicates (same value at the path, or same element), keeps the first.
export const listDedupe = defineBlock({
  type: "list.dedupe",
  label: "Remove duplicates",
  description:
    "Removes duplicate items from a list (by a field or the whole item).",
  sideEffect: false,
  inputSchema: z.object({ items, path }),
  outputSchema: z.object({ items, removed: z.number() }),
  branches: ["ok"],
  run: async ({ items, path }) => {
    const seen = new Set<string>();
    const kept = items.filter((i) => {
      const k = key(at(i, path) ?? null);
      return seen.has(k) ? false : (seen.add(k), true);
    });
    return {
      branch: "ok",
      output: { items: kept, removed: items.length - kept.length },
    };
  },
});

// Sorts by value at the path (numbers then text), missing values last.
export const listSort = defineBlock({
  type: "list.sort",
  label: "Sort a list",
  description: "Sorts the items of a list by a field.",
  sideEffect: false,
  inputSchema: z.object({
    items,
    path,
    order: z.enum(["asc", "desc"]).default("asc"),
  }),
  outputSchema: z.object({ items }),
  branches: ["ok"],
  run: async ({ items, path, order }) => {
    const dir = order === "asc" ? 1 : -1;
    const sorted = [...items].sort((a, b) => {
      const x = at(a, path);
      const y = at(b, path);
      if (x == null) return y == null ? 0 : 1;
      if (y == null) return -1;
      return (
        dir *
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y)))
      );
    });
    return { branch: "ok", output: { items: sorted } };
  },
});

// Keeps a slice of the list (`offset`, then `limit` elements).
export const listLimit = defineBlock({
  type: "list.limit",
  label: "Keep the first items",
  description: "Keeps a limited number of items from a list.",
  sideEffect: false,
  inputSchema: z.object({
    items,
    limit: z.number().int().min(0),
    offset: z.number().int().min(0).default(0),
  }),
  outputSchema: z.object({ items, total: z.number() }),
  branches: ["ok"],
  run: async ({ items, limit, offset }) => ({
    branch: "ok",
    output: { items: items.slice(offset, offset + limit), total: items.length },
  }),
});
