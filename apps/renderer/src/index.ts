// Renderer service: headless Chromium outside the web app. Consumes the
// `render` queue (page.screenshot / page.test captures, axe audits).
// Health: GET /health on RENDERER_HEALTH_PORT (default 7102) returns 200 as long
// as the worker runs and Redis responds.
import { createServer } from "node:http";
import { APP_NAME } from "@getrunbase/core";
import { busConnection } from "@getrunbase/core/bus";
import { env } from "@getrunbase/core/env";
import { startRenderWorker, sweeper } from "./worker";

const worker = startRenderWorker();
worker.on("failed", (job, e) =>
  console.error(`[${APP_NAME}] render job ${job?.id} failed`, e),
);
console.log(`[${APP_NAME}] renderer started`);

// Orphan render PNGs: swept every minute.
const sweepTimer = setInterval(
  () =>
    void sweeper.sweep().then(
      (n) => n && console.log(`[${APP_NAME}] swept ${n} orphan render(s)`),
      (e) => console.error(`[${APP_NAME}] render sweep failed`, e),
    ),
  60_000,
);

const redis = busConnection();
const health = createServer(async (req, res) => {
  const ok =
    req.url === "/health" &&
    worker.isRunning() &&
    (await redis.ping().catch(() => null)) === "PONG";
  res.writeHead(ok ? 200 : 503).end(ok ? "ok" : "unavailable");
}).listen(env().RENDERER_HEALTH_PORT);

// Graceful shutdown (SIGTERM on redeploy): in-flight captures finish.
let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`[${APP_NAME}] ${signal}: stopping renderer…`);
  health.close();
  clearInterval(sweepTimer);
  redis.disconnect();
  await worker.close();
  process.exit(0);
};
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
