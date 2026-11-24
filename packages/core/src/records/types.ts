// Shared types and constants of the records module.
import type { Filter } from "../filter";
import type { objects, records } from "../db/schema";

export type Data = Record<string, unknown>;

export type UpsertInput = {
  objectId: string;
  externalId?: string | null;
  data: Data;
  // "merge" (default) merges with the existing one, "replace" overwrites it.
  mode?: "merge" | "replace";
  // Upsert by unique field (email, domain…) instead of the external_id.
  match?: string;
  // Backfill: written without publishing anything on the bus.
  backfill?: boolean;
  // Test record (at creation): deleted by workspace.purge_test.
  test?: boolean;
};

export type SearchInput = {
  filter?: Filter;
  sort?: { field: string; dir?: "asc" | "desc" }[];
  // `after`: id of the last record of the previous page (keyset pagination,
  // with or without sort); constant cost whatever the depth. No
  // offset.
  pagination?: { limit?: number; after?: string };
  // Full-text search: ILIKE on text, email and url fields.
  q?: string;
};

// Aggregation: one flat row per group ({key: value, <as>: number}).
export type AggregateInput = Pick<
  SearchInput,
  "filter" | "pagination" | "q"
> & {
  groupBy?: string | string[];
  aggregate?: {
    op: "count" | "sum" | "avg" | "min" | "max";
    field?: string;
    as: string;
  }[];
};

// Row types of the objects and records tables.
export type ObjectRow = typeof objects.$inferSelect;
export type RecordRow = typeof records.$inferSelect;

// Max depth of relation paths in templates.
export const MAX_TEMPLATE_HOPS = 3;

export type TransactOp =
  | ({ op: "upsert" } & UpsertInput)
  | { op: "update"; id: string; data: Data; mode?: "merge" | "replace" }
  | { op: "delete"; id: string };

// Trash retention, in days (automatic purge).
export const TRASH_DAYS = 30;
// Cap of filter operations (update_where / delete_where) and of
// CSV import rows.
export const MAX_BULK = 10_000;
