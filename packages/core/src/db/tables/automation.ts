// Automation: workflows, runs, errors, functions and secrets.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, workspaces } from "./tenants";

// Workflows. The definition lives in `workflow_versions`, immutable
// (app_tenant has no UPDATE privilege): a run references the version with
// which it started. `current_version` points to the active version.
export const workflowStatus = pgEnum("workflow_status", [
  "draft",
  "active",
  "paused",
]);

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: workflowStatus("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("workflows_workspace_id_idx").on(t.workspaceId),
    index("workflows_organization_id_idx").on(t.organizationId),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("workflow_versions_workflow_version_idx").on(
      t.workflowId,
      t.version,
    ),
    index("workflow_versions_organization_id_idx").on(t.organizationId),
  ],
);

// Executions. A run pins the workflow version; `step_count` acts as the
// cursor (one step = one BullMQ job). Partial index: a single active run per
// (workflow, record). `waiting`: paused on human.approve; the predicate excludes terminal statuses because an added enum value cannot be used in the migration transaction.
export const runStatus = pgEnum("run_status", [
  "running",
  "waiting",
  "succeeded",
  "failed",
  // Workspace AI budget reached: resumed when it is increased.
  "paused_budget",
  // Manual pause (runs.pause) and cancellation (runs.cancel).
  "paused",
  "canceled",
]);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    recordId: uuid("record_id"),
    actor: jsonb("actor").notNull(),
    input: jsonb("input").notNull(),
    status: runStatus("status").notNull().default("running"),
    currentStep: text("current_step"),
    stepCount: integer("step_count").notNull().default(0),
    // Parallel execution branches: { [path]: { step, n, status } }.
    paths: jsonb("paths").notNull().default({}),
    error: text("error"),
    // Trigger key (bus event × workflow): a bus replay does not
    // create a duplicate run.
    idempotencyKey: text("idempotency_key"),
    // Progress of long steps (loop): { "<path>:<n>": state }, so that a retry
    // does not redo what already succeeded.
    checkpoints: jsonb("checkpoints").notNull().default({}),
    // Started in test mode: deleted by workspace.purge_test.
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("workflow_runs_workspace_id_idx").on(t.workspaceId),
    index("workflow_runs_organization_id_idx").on(t.organizationId),
    index("workflow_runs_workspace_created_idx").on(
      t.workspaceId,
      t.createdAt,
      t.id,
    ),
    // Run lists by status and by workflow.
    index("workflow_runs_workspace_status_created_idx").on(
      t.workspaceId,
      t.status,
      t.createdAt,
    ),
    index("workflow_runs_workflow_created_idx").on(t.workflowId, t.createdAt),
    uniqueIndex("workflow_runs_active_idx")
      .on(t.workflowId, t.recordId)
      .where(sql`finished_at is null`),
    uniqueIndex("workflow_runs_idempotency_idx")
      .on(t.workflowId, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
  ],
);

// Run job outbox: written in the transaction that changes
// the run state, deleted when the job is processed. A worker sweeper
// re-enqueues due rows whose Redis job has disappeared (crash before
// the enqueue, Redis flushed). `waitUntil`: job due date (wait, approval
// expiry, backoff), so waits survive Redis.
export const runOutbox = pgTable(
  "run_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    // "step" (run the step of the path) or "expire" (expired approval).
    kind: text("kind").notNull().default("step"),
    path: text("path").notNull(),
    n: integer("n").notNull(),
    attempt: integer("attempt").notNull().default(0),
    // Resuming an already attempted step: distinct job id (suffix = row id).
    retry: boolean("retry").notNull().default(false),
    waitUntil: timestamp("wait_until").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("run_outbox_wait_until_idx").on(t.waitUntil),
    index("run_outbox_run_id_idx").on(t.runId),
  ],
);

export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    // Execution branch of the step ("0", "1", "0.1"…).
    path: text("path").notNull().default("0"),
    stepId: text("step_id").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    branch: text("branch"),
    durationMs: integer("duration_ms"),
    cost: real("cost"),
    // Tokens consumed by AI blocks: { input, output }.
    tokens: jsonb("tokens"),
    error: text("error"),
    // Start of the persisted attempt and number of attempts (retries).
    startedAt: timestamp("started_at"),
    attempts: integer("attempts").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("run_steps_run_seq_idx").on(t.runId, t.seq),
    index("run_steps_organization_id_idx").on(t.organizationId),
  ],
);

// Error center: ingestion and workflow errors per workspace.
// `payload` keeps what is needed to replay (rejected ingestion body, step input).
export const errorSource = pgEnum("error_source", [
  "ingest",
  "workflow",
  "function",
  "mcp",
  // Code component failing in a user's browser.
  "component",
]);
export const errorStatus = pgEnum("error_status", ["open", "resolved"]);

export const errors = pgTable(
  "errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    source: errorSource("source").notNull(),
    runId: uuid("run_id"),
    stepId: text("step_id"),
    // Ingestion reference: `object[/batch|/import]`.
    request: text("request"),
    message: text("message").notNull(),
    payload: jsonb("payload"),
    stack: text("stack"),
    // Fingerprint of the normalized message: groups occurrences.
    fingerprint: text("fingerprint"),
    status: errorStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("errors_workspace_status_idx").on(t.workspaceId, t.status),
    index("errors_workspace_fingerprint_idx").on(t.workspaceId, t.fingerprint),
    index("errors_workspace_created_idx").on(t.workspaceId, t.createdAt, t.id),
    index("errors_organization_id_idx").on(t.organizationId),
  ],
);

// Functions: one row per version, immutable. The latest version of a
// name is the current one; restoring copies an old version into a new one.
export const functions = pgTable(
  "functions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    code: text("code").notNull(),
    inputSchema: jsonb("input_schema").notNull(),
    outputSchema: jsonb("output_schema").notNull(),
    // { domains: string[], secrets: string[] }
    permissions: jsonb("permissions").notNull(),
    // { timeoutMs?, memoryMb? } bounded by the service.
    limits: jsonb("limits").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("functions_workspace_name_version_idx").on(
      t.workspaceId,
      t.name,
      t.version,
    ),
    index("functions_organization_id_idx").on(t.organizationId),
  ],
);

// Function execution logs (workflow, page, test): bounded console.*,
// possible error. Read by functions.logs and the run step detail.
export const functionLogs = pgTable(
  "function_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    functionName: text("function_name").notNull(),
    version: integer("version").notNull(),
    // workflow | page | test
    source: text("source").notNull(),
    runId: uuid("run_id"),
    path: text("path"),
    stepId: text("step_id"),
    logs: text("logs").notNull().default(""),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("function_logs_workspace_name_idx").on(
      t.workspaceId,
      t.functionName,
      t.createdAt,
    ),
    index("function_logs_run_idx").on(t.runId),
    index("function_logs_organization_id_idx").on(t.organizationId),
  ],
);

// Secrets vault: AES-256-GCM encrypted value, never in plain text.
export const secrets = pgTable(
  "secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    valueEncrypted: text("value_encrypted").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("secrets_workspace_name_idx").on(t.workspaceId, t.name),
    index("secrets_organization_id_idx").on(t.organizationId),
  ],
);

// Data key (DEK) of a workspace: encrypts its secrets;
// itself encrypted by the master key (env or KMS). Rotating the master
// key only re-encrypts these rows.
export const workspaceKeys = pgTable(
  "workspace_keys",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dekEncrypted: text("dek_encrypted").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    rotatedAt: timestamp("rotated_at"),
  },
  (t) => [index("workspace_keys_organization_id_idx").on(t.organizationId)],
);
