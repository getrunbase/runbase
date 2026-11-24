// Health probes: readiness = DB and Redis reachable. Used by
// /api/ready and by the deployment rollout (wait before switching).
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { db } from "../db/client";
import { env } from "../env";

export type Check = () => Promise<unknown>;
export type ReadinessReport = {
  status: "ok" | "down";
  checks: Record<string, "ok" | "down">;
};

const TIMEOUT_MS = 2000;

function withTimeout(p: Promise<unknown>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise((_, ko) => {
      // eslint-disable-next-line no-restricted-syntax -- internal probe
      timer = setTimeout(() => ko(new Error(`timeout after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export const databaseCheck: Check = () => db.execute(sql`select 1`);

// Dedicated connection per URL, without offline queue: a down Redis
// fails right away instead of keeping the command pending.
const probes = new Map<string, Redis>();
export function redisCheck(url = env().REDIS_URL): Check {
  return async () => {
    let probe = probes.get(url);
    if (!probe) {
      probe = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        connectTimeout: TIMEOUT_MS,
        retryStrategy: () => null,
      });
      probe.on("error", () => {}); // the state is reported by ping()
      probes.set(url, probe);
    }
    if (probe.status === "wait" || probe.status === "end")
      await probe.connect();
    return probe.ping();
  };
}

export async function readiness(
  checks: Record<string, Check> = {
    database: databaseCheck,
    redis: redisCheck(),
  },
  timeoutMs = TIMEOUT_MS,
): Promise<ReadinessReport> {
  const entries = Object.entries(checks);
  const results = await Promise.allSettled(
    entries.map(([, check]) => withTimeout(check(), timeoutMs)),
  );
  const report: ReadinessReport = { status: "ok", checks: {} };
  entries.forEach(([name], i) => {
    const ok = results[i]?.status === "fulfilled";
    report.checks[name] = ok ? "ok" : "down";
    if (!ok) report.status = "down";
  });
  return report;
}
