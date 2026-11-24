// Next.js server instrumentation: JSON log
// of every request error (route 5xx, server components, actions).
// On startup: validated configuration (fails fast and readably)
// then OpenTelemetry metrics, no-op without OTEL_METRICS_EXPORTER.
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@runbase/core/env");
    validateEnv("web");
    // Extension points: RUNBASE_EXTENSIONS, otherwise no-op.
    const { loadExtensions, track } = await import("@runbase/core/extensions");
    await loadExtensions();
    await track("web.started");
    const { startMetrics } = await import("@runbase/core/telemetry");
    startMetrics("runbase-web", { routes: true });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logger } = await import("@runbase/core/logger");
    const headers = request.headers as Record<string, string | undefined>;
    logger.error(
      {
        err,
        requestId: headers["x-request-id"],
        method: request.method,
        path: request.path,
        routePath: context.routePath,
        routeType: context.routeType,
      },
      "request failed",
    );
  }
};
