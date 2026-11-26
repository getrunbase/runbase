// Environment schema: default values, missing variable,
// invalid value.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authMethod,
  EnvError,
  googleSignInConfigured,
  parseEnv,
  placeholderSecrets,
} from "./env";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
};

test("env: default values and conversions", () => {
  const e = parseEnv({
    ...base,
    PG_POOL_MAX: "20",
    PG_PREPARE: "false",
    SIGNUPS_ENABLED: "TRUE",
    PLATFORM_ADMIN_EMAILS: " A@x.io, b@x.io ,",
    RESEND_API_KEY: "",
  });
  assert.equal(e.PG_POOL_MAX, 20);
  assert.equal(e.PG_PREPARE, false);
  assert.equal(e.SIGNUPS_ENABLED, true);
  assert.deepEqual(e.PLATFORM_ADMIN_EMAILS, ["a@x.io", "b@x.io"]);
  // `KEY=` empty counts as missing.
  assert.equal(e.RESEND_API_KEY, undefined);
  assert.equal(e.QUERY_PG_POOL_MAX, 5);
  assert.equal(e.QUERY_TIMEOUT_MS, 10_000);
  assert.equal(e.REDIS_URL, "redis://127.0.0.1:6380");
  assert.equal(e.OTEL_METRICS_EXPORTER, "none");
  assert.equal(e.FUNCTIONS_ALLOW_PRIVATE_NETWORK, false);
  assert.equal(e.QUEUE_PREFIX, "bull");
  assert.equal(e.RETENTION_DAYS, undefined);
  assert.equal(e.RETENTION_CRON, "0 3 * * *");
  assert.equal(e.USAGE_REPORT_CRON, "0 * * * *");
  assert.equal(e.LOG_LEVEL, undefined);
  assert.equal(e.QUOTA_CONCURRENCY, 5);
  assert.equal(e.QUOTA_MAX_RECORDS, undefined);
});

test("env: invalid logs and retention refused", () => {
  assert.throws(
    () =>
      parseEnv({
        ...base,
        LOG_LEVEL: "verbose",
        RETENTION_DAYS: "-1",
        QUOTA_CONCURRENCY: "0",
      }),
    (e: Error) =>
      [
        "LOG_LEVEL",
        "RETENTION_DAYS",
        "QUOTA_CONCURRENCY",
      ].every((k) => e.message.includes(`  - ${k}: `)),
  );
});

test("env: missing mandatory variable, clear message per app", () => {
  assert.throws(
    () => parseEnv({ BETTER_AUTH_SECRET: base.BETTER_AUTH_SECRET }, "worker"),
    (e: Error) =>
      e instanceof EnvError &&
      e.message.startsWith("Invalid environment configuration:") &&
      e.message.includes("DATABASE_URL: required by the worker"),
  );
  assert.throws(
    () => parseEnv({ DATABASE_URL: base.DATABASE_URL, BETTER_AUTH_SECRET: "" }, "web"),
    /BETTER_AUTH_SECRET: required by the web/,
  );
  // Master key and sandbox token are required by both apps.
  assert.throws(
    () => parseEnv({ DATABASE_URL: base.DATABASE_URL }, "worker"),
    (e: Error) =>
      e.message.includes("SECRETS_MASTER_KEY: required by the worker") &&
      e.message.includes("SANDBOX_TOKEN: required by the worker"),
  );
  const keys = {
    SECRETS_MASTER_KEY: Buffer.alloc(32).toString("base64"),
    SANDBOX_TOKEN: "t".repeat(16),
  };
  // The worker does not require the auth secret; without app, nothing is mandatory.
  assert.doesNotThrow(() =>
    parseEnv({ DATABASE_URL: base.DATABASE_URL, ...keys }, "worker"),
  );
  assert.doesNotThrow(() => parseEnv({ ...base, ...keys }, "web"));
  assert.doesNotThrow(() => parseEnv({}));
});

test("env: invalid values listed together", () => {
  assert.throws(
    () =>
      parseEnv({
        ...base,
        DATABASE_URL: "not a url",
        PG_POOL_MAX: "abc",
        PG_PREPARE: "yes",
        SECRETS_MASTER_KEY: "c2hvcnQ=",
        OTEL_METRICS_EXPORTER: "jaeger",
      }),
    (e: Error) =>
      ["DATABASE_URL", "PG_POOL_MAX", "PG_PREPARE", "SECRETS_MASTER_KEY", "OTEL_METRICS_EXPORTER"].every(
        (k) => e.message.includes(`  - ${k}: `),
      ),
  );
  assert.throws(
    () => parseEnv({ ...base, OTEL_METRICS_EXPORTER: "otlp" }),
    /OTEL_EXPORTER_OTLP_ENDPOINT: required when OTEL_METRICS_EXPORTER=otlp/,
  );
});

test("env : AUTH_METHOD", () => {
  assert.equal(parseEnv(base).AUTH_METHOD, "magic-link");
  assert.equal(parseEnv({ ...base, AUTH_METHOD: "password" }).AUTH_METHOD, "password");
  assert.throws(
    () => parseEnv({ ...base, AUTH_METHOD: "sms" }),
    (e: unknown) => e instanceof EnvError && /AUTH_METHOD: expected "magic-link" or "password"/.test(e.message),
  );
  const prev = process.env.AUTH_METHOD;
  process.env.AUTH_METHOD = "password";
  try {
    assert.equal(authMethod(), "password");
  } finally {
    if (prev === undefined) delete process.env.AUTH_METHOD;
    else process.env.AUTH_METHOD = prev;
  }
});

test("env: change-me secrets refused at startup in production only", () => {
  const weak = {
    ...base,
    SECRETS_MASTER_KEY: Buffer.alloc(32).toString("base64"),
    BETTER_AUTH_SECRET: "change-me-32-characters-minimum!!",
    REDIS_URL: "redis://:change-me-redis@localhost:6380",
    SANDBOX_TOKEN: "change-me-sandbox-token",
  };
  assert.deepEqual(placeholderSecrets(weak), [
    "BETTER_AUTH_SECRET",
    "REDIS_URL",
    "SANDBOX_TOKEN",
  ]);
  // Development, or parsing without an app: accepted.
  assert.doesNotThrow(() => parseEnv(weak, "web"));
  assert.doesNotThrow(() => parseEnv({ ...weak, NODE_ENV: "production" }));
  assert.throws(
    () => parseEnv({ ...weak, NODE_ENV: "production" }, "web"),
    (e: Error) =>
      e instanceof EnvError &&
      /BETTER_AUTH_SECRET: still a "change-me"/.test(e.message) &&
      /REDIS_URL/.test(e.message),
  );
  assert.doesNotThrow(() => parseEnv(
      {
        ...base,
        NODE_ENV: "production",
        SECRETS_MASTER_KEY: Buffer.alloc(32).toString("base64"),
        SANDBOX_TOKEN: "s".repeat(32),
      },
      "web",
    ));
  // Explicit opt-out of the local docker-compose stack.
  assert.doesNotThrow(() =>
    parseEnv(
      { ...weak, NODE_ENV: "production", RUNBASE_ALLOW_PLACEHOLDER_SECRETS: "1" },
      "web",
    ),
  );
});

test("env: Sign in with Google offered only with a full Google OAuth client", () => {
  const keys = ["OAUTH_GOOGLE_CLIENT_ID", "OAUTH_GOOGLE_CLIENT_SECRET"] as const;
  const prev = keys.map((k) => process.env[k]);
  try {
    for (const k of keys) delete process.env[k];
    assert.equal(googleSignInConfigured(), false);
    process.env.OAUTH_GOOGLE_CLIENT_ID = "id.apps.googleusercontent.com";
    assert.equal(googleSignInConfigured(), false);
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = "";
    assert.equal(googleSignInConfigured(), false);
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = "secret";
    assert.equal(googleSignInConfigured(), true);
  } finally {
    keys.forEach((k, i) => {
      if (prev[i] === undefined) delete process.env[k];
      else process.env[k] = prev[i];
    });
  }
});
