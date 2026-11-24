// Centralized environment configuration: a single zod schema for
// all variables read by the core, web and worker. `env()` rereads
// process.env on each call (tests keep their overrides) and fails on
// an invalid value; `validateEnv(app)` also checks, at startup, the
// app's mandatory variables, with a clear (English) message.
import { z } from "zod";

// "1"/"true"/"0"/"false" (case ignored); missing = default value.
const flag = (fallback: boolean) =>
  z
    .string()
    .regex(/^(1|0|true|false)$/i, "expected true, false, 1 or 0")
    .transform((v) => /^(1|true)$/i.test(v))
    .default(fallback);
const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const url = z.url();

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NODE_TEST_CONTEXT: z.string().optional(),
  PORT: int(7100),

  // Postgres
  DATABASE_URL: url.optional(),
  QUERY_DATABASE_URL: url.optional(),
  PG_POOL_MAX: int(10),
  QUERY_PG_POOL_MAX: int(5),
  PG_PREPARE: flag(true),
  QUERY_TIMEOUT_MS: int(10_000),

  REDIS_URL: url.default("redis://127.0.0.1:6380"),

  // Auth and access
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
  BETTER_AUTH_URL: url.optional(),
  SIGNUPS_ENABLED: flag(false),
  // Sign-in method, read at runtime (prebuilt Docker image).
  AUTH_METHOD: z
    .enum(["magic-link", "password"], {
      error: 'expected "magic-link" or "password"',
    })
    .default("magic-link"),
  PLATFORM_ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  SECRETS_MASTER_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, "base64").length === 32,
      "must be 32 bytes encoded in base64",
    )
    .optional(),

  // Files
  FILES_DRIVER: z.enum(["local", "s3", "memory"]).default("local"),
  FILES_DIR: z.string().optional(),
  S3_ENDPOINT: url.optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Public route limits (apps/web/lib/request-limits.ts).
  BODY_MAX_BYTES: int(1_048_576),
  IP_RATE_HOOKS: int(600),
  IP_RATE_INGEST: int(600),
  IP_RATE_AUTH: int(60),
  IP_RATE_MCP: int(600),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  // Code sandbox: shared secret between web/worker and the sandbox.
  SANDBOX_TOKEN: z.string().min(16, "must be at least 16 characters").optional(),

  // HTTP block / external fetches: response size cap (bytes).
  HTTP_BLOCK_MAX_BYTES: int(10 * 1024 * 1024),

  // Renderer
  RENDERER_APP_URL: url.optional(),
  RENDER_CONCURRENCY: int(2),
  RENDERER_HEALTH_PORT: int(7102),

  // Functions and workflows
  DENO_BIN: z.string().default("deno"),
  FUNCTIONS_ALLOW_PRIVATE_NETWORK: flag(false),
  WORKER_CONCURRENCY: int(10),
  STEP_TIMEOUT_MS: int(5 * 60_000),
  LIST_MAX_ITEMS: int(1000),

  // Quotas and AI
  QUOTA_RECORDS: int(100_000),
  QUOTA_RUNS_PER_MINUTE: int(120),
  QUOTA_API_PER_MINUTE: int(1_200),
  // Concurrent jobs per workspace, by default.
  QUOTA_CONCURRENCY: int(5),
  // Caps without a billing extension: missing = unlimited.
  // An extension (`billing.entitlements`) replaces them per organization.
  QUOTA_MAX_RECORDS: z.coerce.number().int().positive().optional(),
  QUOTA_MAX_RUNS_PER_MINUTE: z.coerce.number().int().positive().optional(),
  QUOTA_MAX_API_PER_MINUTE: z.coerce.number().int().positive().optional(),
  QUOTA_MAX_WORKSPACES: z.coerce.number().int().positive().optional(),
  QUOTA_MAX_AI_BUDGET_USD: z.coerce.number().positive().optional(),
  QUOTA_LIMITS_TTL_MS: int(15_000),

  // Emails
  // Resend, otherwise SMTP, otherwise console mode (email/index.ts).
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: int(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.enum(["true", "false"]).optional(),

  // Worker and web
  BOARD_PORT: int(7101),
  PLAYWRIGHT_CHROMIUM_PATH: z.string().optional(),
  // Chromium OS sandbox. Off only where the container is the boundary
  // (no-new-privileges and seccomp forbid its setuid/user namespaces).
  CHROMIUM_SANDBOX: flag(true),

  // BullMQ queues: key prefix (isolates a test run on a shared Redis).
  QUEUE_PREFIX: z.string().default("bull"),

  // Retention in days: missing = no purge. An extension
  // sets it per organization (quota:retentionDays). Purge schedule.
  RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  RETENTION_CRON: z.string().default("0 3 * * *"),

  // Logs.
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .optional(),
  SERVICE_NAME: z.string().optional(),
  APP_VERSION: z.string().optional(),

  // OpenTelemetry metrics: no export by default.
  OTEL_METRICS_EXPORTER: z.enum(["none", "otlp", "console"]).default("none"),
  OTEL_EXPORTER_OTLP_ENDPOINT: url.optional(),
  OTEL_METRIC_EXPORT_INTERVAL: int(60_000),
  OTEL_SERVICE_NAME: z.string().optional(),

  // Local docker-compose stack only: accepts `change-me` secrets in production.
  RUNBASE_ALLOW_PLACEHOLDER_SECRETS: flag(false),

  // Extension points: module loaded at startup, otherwise no-op.
  RUNBASE_EXTENSIONS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
export type App = "web" | "worker";

// Variables without which the app cannot start.
const REQUIRED: Record<App, (keyof Env)[]> = {
  web: ["DATABASE_URL", "BETTER_AUTH_SECRET", "SECRETS_MASTER_KEY", "SANDBOX_TOKEN"],
  worker: ["DATABASE_URL", "SECRETS_MASTER_KEY", "SANDBOX_TOKEN"],
};

export class EnvError extends Error {
  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
    );
    this.name = "EnvError";
  }
}

// Secret-bearing variables: name, or URL credentials (`postgres://u:pw@`).
const SECRET_NAME = /(SECRET|PASSWORD|TOKEN|_KEY)$/;
const SECRET_URL = /^(DATABASE_URL|QUERY_DATABASE_URL|REDIS_URL)$/;

// Variables still holding a `change-me` placeholder from .env.example.
export function placeholderSecrets(source: Record<string, string | undefined>) {
  return Object.entries(source)
    .filter(([k, v]) => {
      if (!v) return false;
      if (SECRET_NAME.test(k)) return v.startsWith("change-me");
      if (!SECRET_URL.test(k)) return false;
      try {
        return decodeURIComponent(new URL(v).password).startsWith("change-me");
      } catch {
        return false;
      }
    })
    .map(([k]) => k)
    .sort();
}

// An empty value (`KEY=` in .env) counts as missing.
const clean = (source: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));

export function parseEnv(
  source: Record<string, string | undefined> = process.env,
  app?: App,
): Env {
  const r = envSchema.safeParse(clean(source));
  const issues = r.success
    ? []
    : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  if (r.success && r.data.OTEL_METRICS_EXPORTER === "otlp" && !r.data.OTEL_EXPORTER_OTLP_ENDPOINT)
    issues.push("OTEL_EXPORTER_OTLP_ENDPOINT: required when OTEL_METRICS_EXPORTER=otlp");
  const present = clean(source);
  if (app)
    for (const k of REQUIRED[app])
      if (present[k] === undefined) issues.push(`${k}: required by the ${app}`);
  // At startup in production, a placeholder secret is refused.
  if (
    app &&
    r.success &&
    r.data.NODE_ENV === "production" &&
    !r.data.RUNBASE_ALLOW_PLACEHOLDER_SECRETS
  )
    for (const k of placeholderSecrets(present))
      issues.push(`${k}: still a "change-me" placeholder, set a strong random value`);
  if (issues.length) throw new EnvError(issues);
  return r.data!;
}

export const env = () => parseEnv(process.env);

// Public URL of the app (BETTER_AUTH_URL), localhost in dev.
export const appUrl = () => env().BETTER_AUTH_URL ?? "http://localhost:7100";

export type AuthMethod = Env["AUTH_METHOD"];
export const authMethod = (): AuthMethod => env().AUTH_METHOD;

// A real mail provider is configured (otherwise console mode).
export const emailConfigured = () => {
  const e = env();
  return !!(e.RESEND_API_KEY || e.SMTP_HOST);
};

// At web and worker startup: immediate and readable failure.
export const validateEnv = (app: App) => parseEnv(process.env, app);
