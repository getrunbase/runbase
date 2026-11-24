// Data model: databases, objects, views, records and events.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, workspaces } from "./tenants";

// Databases: group the objects of a workspace, like Notion
// databases. Object slugs stay unique per workspace.
export const databases = pgTable(
  "databases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("databases_workspace_slug_idx").on(t.workspaceId, t.slug),
    index("databases_organization_id_idx").on(t.organizationId),
  ],
);

// Objects with a typed schema: the schema (`fields`) is data, not a
// migration. See src/objects for field types and the validator.
export const objects = pgTable(
  "objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Restrict: deleting a database goes through databasesService.
    databaseId: uuid("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    fields: jsonb("fields").notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("objects_workspace_slug_idx").on(t.workspaceId, t.slug),
    index("objects_organization_id_idx").on(t.organizationId),
    index("objects_database_id_idx").on(t.databaseId),
  ],
);

// Saved views of an object: named filter, sort and visible columns,
// reusable in the table, by agents and by pages.
export const objectViews = pgTable(
  "object_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    objectId: uuid("object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filter: jsonb("filter"),
    sort: jsonb("sort").notNull().default([]),
    // Keys of the displayed columns, in order; null = all.
    columns: jsonb("columns"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("object_views_object_name_idx").on(t.objectId, t.name),
    index("object_views_organization_id_idx").on(t.organizationId),
  ],
);

// Records of an object: values in JSONB, validated against `objects.fields`.
// Idempotent upsert by (object_id, external_id).
export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    objectId: uuid("object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    // Created in test mode: deleted by workspace.purge_test.
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("records_object_external_id_idx").on(t.objectId, t.externalId),
    index("records_data_idx").using("gin", t.data),
    // Full-text search (q) on large volumes: trigrams on data::text.
    index("records_data_trgm_idx").using(
      "gin",
      sql`(${t.data}::text) gin_trgm_ops`,
    ),
    index("records_organization_id_idx").on(t.organizationId),
    // Default sort of the table view: fast pagination over 100k.
    index("records_object_created_idx").on(
      t.objectId,
      t.createdAt.desc().nullsFirst(),
      t.id,
    ),
    // List of an object's records in a workspace. Created
    // CONCURRENTLY by db/migrate.ts, outside the migration transaction.
    index("records_ws_obj_created_idx").on(
      t.workspaceId,
      t.objectId,
      t.createdAt,
    ),
  ],
);

// Records trash: a deleted record leaves `records` (so it disappears
// from all reads, searches and SQL views) and lives here with its deletion
// date until it is restored or purged. `links`: references
// (ref/refs) removed from other records at deletion, put back on
// restauration.
export const deletedRecords = pgTable(
  "deleted_records",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    objectId: uuid("object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    links: jsonb("links")
      .$type<{ id: string; key: string }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    deletedAt: timestamp("deleted_at").defaultNow().notNull(),
  },
  (t) => [
    index("deleted_records_object_deleted_idx").on(t.objectId, t.deletedAt),
    index("deleted_records_organization_id_idx").on(t.organizationId),
  ],
);

// Events: timestamped facts, attached or not to a record. A record's
// timeline is read by (record_id, occurred_at).
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // No foreign key: the timeline survives the record deletion
    // (trash) and finds it again on restore; set to null on purge.
    recordId: uuid("record_id"),
    type: text("type").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    source: text("source"),
    // External event id (webhook, replay): a single event per key.
    idempotencyKey: text("idempotency_key"),
    // Created in test mode: deleted by workspace.purge_test.
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("events_workspace_idempotency_idx").on(
      t.workspaceId,
      t.idempotencyKey,
    ),
    index("events_record_occurred_idx").on(t.recordId, t.occurredAt),
    index("events_workspace_type_occurred_idx").on(
      t.workspaceId,
      t.type,
      t.occurredAt,
    ),
    index("events_organization_id_idx").on(t.organizationId),
    // Workspace list, from newest to oldest.
    index("events_workspace_occurred_idx").on(
      t.workspaceId,
      t.occurredAt,
      t.id,
    ),
  ],
);

// Ingestion idempotency keys: response stored per
// (workspace, Idempotency-Key), replayed identically.
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    // Key bound to the route and the body hash; status null = in progress.
    route: text("route").notNull().default(""),
    requestHash: text("request_hash").notNull().default(""),
    status: integer("status"),
    response: jsonb("response"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);
