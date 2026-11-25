// Tenants, Better Auth, API keys and audit log.
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Test table validating the migration pipeline.
export const healthcheck = pgTable("healthcheck", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Tenants. Business tables carry organization_id and workspace_id
// (FK + index), modeled on `workspaces`.

// Better Auth user table, created here for the memberships FK.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// One workspace per SaaS.
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // External block settings: allowed domains, secrets, MCP servers.
    settings: jsonb("settings").default({}).notNull(),
    // Monthly AI budget: USD cap (null = unlimited) and the
    // cumulative counter for month `aiSpentMonth` (YYYY-MM), fed by `run_steps.cost`.
    aiBudgetUsd: real("ai_budget_usd"),
    aiSpentUsd: real("ai_spent_usd").notNull().default(0),
    aiSpentMonth: text("ai_spent_month"),
    // Workspace quotas: overrides of the default values (see quotas/).
    limits: jsonb("limits")
      .$type<{
        records?: number;
        runsPerMinute?: number;
        apiPerMinute?: number;
        concurrency?: number;
      }>()
      .default({})
      .notNull(),
    // Last activity (UI session, API/MCP call, manual run), see
    // workspaces/activity.ts. Null = no activity recorded yet.
    lastActiveAt: timestamp("last_active_at"),
    // Paused workspace (null = active): crons and triggers stop, data stays.
    // The next activity resumes it. Nothing pauses by default.
    pausedAt: timestamp("paused_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("workspaces_organization_id_idx").on(t.organizationId)],
);

// Usage per workspace: record count, kept up to date by
// triggers on `records` (insert/delete, cascades and purges included).
// The quota check locks the row (UPDATE … WHERE records + k <=
// limit): concurrent inserts never exceed the quota.
export const workspaceUsage = pgTable("workspace_usage", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  records: integer("records").notNull().default(0),
  // Runs started in `runsMonth` (first day of the UTC month): reset when
  // the first run of a new month is counted.
  runs: integer("runs").notNull().default(0),
  runsMonth: date("runs_month"),
  // Bytes of attached files stored by the workspace (upload/delete).
  storageBytes: bigint("storage_bytes", { mode: "number" }).notNull().default(0),
});

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "admin",
  "member",
  // Read-only everywhere.
  "viewer",
  // End user: only opens pages.
  "end_user",
]);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    // Pending invitation while null: no access before acceptance.
    acceptedAt: timestamp("accepted_at").defaultNow(),
    // Accessible workspaces: null = all those of the organization.
    workspaceIds: uuid("workspace_ids").array(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("memberships_user_org_idx").on(t.userId, t.organizationId),
    index("memberships_organization_id_idx").on(t.organizationId),
  ],
);

// Better Auth tables: sessions, accounts (password), verifications (reset).
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// Scoped API keys: only the SHA-256 hash of the key is stored.
export const apiKeyScope = pgEnum("api_key_scope", ["read", "write", "admin"]);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    workspaceIds: uuid("workspace_ids").array().notNull(),
    scopes: apiKeyScope("scopes").array().notNull(),
    // Optional restrictions (null = everything): MCP tools and object slugs.
    tools: text("tools").array(),
    objects: text("objects").array(),
    keyHash: text("key_hash").notNull().unique(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("api_keys_organization_id_idx").on(t.organizationId)],
);

// Default workspace of an MCP client (stateless server): principal
// `user:<userId>:<clientId>` (OAuth) or `key:<apiKeyId>`. Read outside RLS, like memberships.
export const mcpWorkspaceDefaults = pgTable("mcp_workspace_defaults", {
  principal: text("principal").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Audit log: every service mutation, append-only.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Deliberately without FK: history must survive deletion of the
    // workspace. Indexed (audit_log_workspace_id_idx) for per-workspace reads.
    workspaceId: uuid("workspace_id").notNull(),
    actorUserId: text("actor_user_id"),
    actorApiKeyId: uuid("actor_api_key_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    diff: jsonb("diff"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("audit_log_resource_idx").on(
      t.organizationId,
      t.resourceType,
      t.resourceId,
    ),
    index("audit_log_workspace_id_idx").on(t.workspaceId),
  ],
);
