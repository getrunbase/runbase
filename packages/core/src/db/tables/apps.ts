// Apps: saved queries, pages, record keys, webhooks and feedback.
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { objects, records } from "./data";
import { organizations, workspaces } from "./tenants";

// Saved and named SQL queries.
export const savedQueries = pgTable(
  "saved_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sql: text("sql").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("saved_queries_workspace_name_idx").on(t.workspaceId, t.name),
    index("saved_queries_organization_id_idx").on(t.organizationId),
  ],
);

// Workspace of each connection of the query pool: written by the
// owner connection, read by the views of the `query` schema (0001_roles_rls_views).
export const querySessions = pgTable("query_sessions", {
  pid: integer("pid").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
});

// Pages: versioned like workflows. The definition lives in
// `page_versions`, immutable; `current_version` points to the active version.
// Page = multi-file TSX package. The `files`… columns hold the
// draft; `currentVersion` points to the published snapshot (null = never published).
export type PageFiles = Record<string, string>;
export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon").notNull().default("layout-dashboard"),
    files: jsonb("files").$type<PageFiles>().notNull(),
    entry: text("entry").notNull().default("index.tsx"),
    // Compiled output of the draft (13.2), null until compiled.
    bundle: text("bundle"),
    deps: jsonb("deps").$type<Record<string, string>>().notNull().default({}),
    // SDK permissions declared by the page.
    permissions: jsonb("permissions")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // Draft differs from the published version.
    hasDraft: boolean("has_draft").notNull().default(true),
    currentVersion: integer("current_version"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("pages_workspace_id_idx").on(t.workspaceId),
    index("pages_organization_id_idx").on(t.organizationId),
  ],
);

// Page runtime errors reported by the iframe: deduplicated
// by fingerprint (page, version, fingerprint), expired after 24 h (lastSeen).
// version 0 = draft.
export const pageErrors = pgTable(
  "page_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(0),
    fingerprint: text("fingerprint").notNull(),
    message: text("message").notNull(),
    // file:line:column of the package source (through sourcemap), if resolved.
    location: text("location"),
    stack: text("stack"),
    count: integer("count").notNull().default(1),
    firstSeen: timestamp("first_seen").defaultNow().notNull(),
    lastSeen: timestamp("last_seen").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("page_errors_page_fingerprint_idx").on(
      t.pageId,
      t.version,
      t.fingerprint,
    ),
    index("page_errors_organization_id_idx").on(t.organizationId),
  ],
);

// Immutable snapshot of a published package.
export const pageVersions = pgTable(
  "page_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    files: jsonb("files").$type<PageFiles>().notNull(),
    entry: text("entry").notNull(),
    bundle: text("bundle"),
    deps: jsonb("deps").$type<Record<string, string>>().notNull().default({}),
    permissions: jsonb("permissions")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("page_versions_page_version_idx").on(t.pageId, t.version),
    index("page_versions_organization_id_idx").on(t.organizationId),
  ],
);

// Unique keys per field (field `unique: true`): a normalized value
// belongs to at most one record of the object. Maintained by upsertInTx;
// also used for upsert by field (`match`).
export const recordKeys = pgTable(
  "record_keys",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    objectId: uuid("object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    value: text("value").notNull(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.objectId, t.field, t.value] }),
    index("record_keys_record_id_idx").on(t.recordId),
  ],
);

// Signed incoming webhooks: public endpoint /api/hooks/<id>, signature
// verified (preset or configurable HMAC) then event `type` pushed, deduplicated
// by the external id (`config.idPath`).
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Type of the event pushed on each valid reception.
    eventType: text("event_type").notNull(),
    // Name of the (vault) secret that holds the signing key.
    secretName: text("secret_name").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    // Last valid payload received (example to map fields).
    sample: jsonb("sample"),
    sampleAt: timestamp("sample_at"),
    // Actor of the pushed events (must stay a member, or a non-revoked key).
    createdBy: text("created_by"),
    createdByKey: uuid("created_by_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("webhooks_workspace_name_idx").on(t.workspaceId, t.name),
    index("webhooks_organization_id_idx").on(t.organizationId),
  ],
);

// Product feedback (bugs, limits, ideas) reported by agents through MCP.
// Insert-only on the tenant side (RLS); reading reserved to platform admins.
export const feedbackKind = pgEnum("feedback_kind", [
  "bug",
  "limit",
  "idea",
  "usage",
]);
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull(),
    actorUserId: text("actor_user_id"),
    actorApiKeyId: uuid("actor_api_key_id"),
    kind: feedbackKind("kind").notNull(),
    title: text("title").notNull(),
    details: text("details").notNull(),
    tool: text("tool"),
    context: jsonb("context"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("feedback_created_at_idx").on(t.createdAt)],
);

// Workspace notes: persistent agent memory (decisions, conventions, pitfalls)
// attached to one entity. `entity_id` is the workspace, object, workflow or
// page id, or the function name. `entity_version` is the entity version the
// note was written against, to flag notes that may be stale.
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    entityVersion: text("entity_version"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("notes_entity_title_idx").on(
      t.workspaceId,
      t.entityType,
      t.entityId,
      t.title,
    ),
    index("notes_organization_id_idx").on(t.organizationId),
  ],
);
