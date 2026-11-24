// Handlers of the /api/health (liveness) and /api/ready (readiness) probes, separate
// from the route files so they can be tested with simulated dependencies.
import { readiness, type ReadinessReport } from "@runbase/core/health";

const NO_STORE = { "cache-control": "no-store" };

// Liveness: the process responds, without touching dependencies (a slow
// Postgres must not restart the web container).
export const healthHandler = () => () =>
  Response.json({ status: "ok" }, { headers: NO_STORE });

// Readiness: 503 if the DB or Redis is unreachable (the rollout waits for 200
// before switching traffic).
export const readyHandler =
  (check: () => Promise<ReadinessReport> = () => readiness()) =>
  async () => {
    const report = await check();
    return Response.json(report, {
      status: report.status === "ok" ? 200 : 503,
      headers: NO_STORE,
    });
  };
