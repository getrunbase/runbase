// Bull Board: monitoring of the queues of all tenants, restricted
// to platform admins (PLATFORM_ADMIN_EMAILS allowlist), through the Better Auth
// session cookie shared with the web app. Empty allowlist: access denied.
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { auth } from "@getrunbase/core/auth";
import { busQueue } from "@getrunbase/core/bus";
import { runsQueue } from "@getrunbase/core/runs";
import { scheduleQueue } from "@getrunbase/core/triggers";
import { env } from "@getrunbase/core/env";
import { logger } from "@getrunbase/core/logger";

const BASE = "/admin/queues";

const platformAdmins = () => new Set(env().PLATFORM_ADMIN_EMAILS);

// `isHealthy`: /healthz probe (worker liveness, Docker healthcheck),
// public, outside the protected prefix.
export function createBoardApp(isHealthy: () => boolean = () => true) {
  const adapter = new HonoAdapter(serveStatic).setBasePath(BASE);
  createBullBoard({
    queues: [busQueue(), runsQueue(), scheduleQueue()].map(
      (q) => new BullMQAdapter(q),
    ),
    serverAdapter: adapter,
  });
  const app = new Hono();
  app.get("/healthz", (c) =>
    isHealthy() ? c.json({ status: "ok" }) : c.json({ status: "down" }, 503),
  );
  app.use(`${BASE}/*`, async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.text("Not authenticated", 401);
    if (!platformAdmins().has(session.user.email.toLowerCase()))
      return c.text("Platform admins only", 403);
    await next();
  });
  app.route(BASE, adapter.registerPlugin());
  return app;
}

export const startBoard = (
  isHealthy?: () => boolean,
  port = env().BOARD_PORT,
) =>
  serve({ fetch: createBoardApp(isHealthy).fetch, port }, () =>
    logger.info(
      { url: `http://localhost:${port}${BASE}` },
      "Bull Board started",
    ),
  );
