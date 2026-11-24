// Shared JSON logger (pino): web, worker and core services. One JSON line
// per event on stdout, collected by the Docker log driver.
// Correlation context: workspaceId, runId, requestId through withContext().
import pino, { type DestinationStream, type Logger } from "pino";
import { env } from "../env";

export type LogContext = {
  workspaceId?: string;
  runId?: string;
  requestId?: string;
  [key: string]: unknown;
};

// Fields never written in plain text (headers, secrets passed by mistake).
const REDACT = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "*.password",
  "*.token",
  "*.secret",
  "*.authorization",
  "*.cookie",
];

export function createLogger(
  options: { service?: string; level?: string } = {},
  destination?: DestinationStream,
): Logger {
  const opts = {
    level:
      options.level ??
      env().LOG_LEVEL ??
      (env().NODE_ENV === "test" ? "silent" : "info"),
    base: {
      service: options.service ?? env().SERVICE_NAME ?? "runbase",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label: string) => ({ level: label }) },
    redact: { paths: REDACT, censor: "[redacted]" },
    serializers: { err: pino.stdSerializers.err },
  };
  return destination ? pino(opts, destination) : pino(opts);
}

export const logger = createLogger();

// Child logger carrying the correlation context (empty fields omitted).
export function withContext(ctx: LogContext, base: Logger = logger): Logger {
  return base.child(
    Object.fromEntries(Object.entries(ctx).filter(([, v]) => v != null)),
  );
}

export type { Logger };
