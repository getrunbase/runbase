// Public route limits: per-IP limit before any
// authentication (sliding window in Redis), maximum body size.
// Used by middleware.ts and by the hooks/ingest routes (capped read).
import Redis from "ioredis";
import { env } from "@getrunbase/core/env";
import { logger } from "@getrunbase/core/logger";

// Maximum body size (bytes), 1 MB by default (BODY_MAX_BYTES).
export const bodyMaxBytes = () => env().BODY_MAX_BYTES;

// Calls per minute and per IP, per route family (IP_RATE_<FAMILY>).
// Defaults in the env schema (@getrunbase/core/env).
const IP_KEYS = {
  hooks: "IP_RATE_HOOKS",
  ingest: "IP_RATE_INGEST",
  auth: "IP_RATE_AUTH",
  mcp: "IP_RATE_MCP",
} as const;
export type IpBucket = keyof typeof IP_KEYS;
const ipLimit = (b: IpBucket) => env()[IP_KEYS[b]];

export function bucketOf(pathname: string): IpBucket | null {
  if (pathname.startsWith("/api/hooks/")) return "hooks";
  if (pathname.startsWith("/api/ingest/")) return "ingest";
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/"))
    return "auth";
  if (pathname === "/api/mcp" || pathname.startsWith("/api/mcp/")) return "mcp";
  return null;
}

// Client IP. X-Forwarded-For is trusted only behind trusted
// proxies: TRUSTED_PROXY_HOPS = number of proxies in front of Next (Caddy: 1),
// each appending the address it saw on the right of the list. Without a proxy (0), Next
// fills the header with the socket address if it is missing: the
// last entry is used.
export function clientIp(
  headers: Headers,
  hops = env().TRUSTED_PROXY_HOPS,
): string {
  const list = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list[Math.max(list.length - Math.max(hops, 1), 0)] ?? "unknown";
}

let redis: Redis | undefined;
const connection = () =>
  (redis ??= new Redis(env().REDIS_URL, {
    // Redis down: fail fast (no indefinite wait per request).
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  }));

const WINDOW_MS = 60_000;

// Approximate sliding window: current minute counter + remaining
// share of the previous one. Refused without increment. Redis unavailable:
// let it through (per-workspace limits apply after auth).
export async function ipRateLimit(
  bucket: IpBucket,
  ip: string,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const max = ipLimit(bucket);
  const win = Math.floor(now / WINDOW_MS);
  const elapsed = (now % WINDOW_MS) / WINDOW_MS;
  const key = (w: number) => `rl:ip:${bucket}:${ip}:${w}`;
  try {
    const r = connection();
    const [cur, prev] = (await r.mget(key(win), key(win - 1))).map(Number);
    if ((prev ?? 0) * (1 - elapsed) + (cur ?? 0) >= max)
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil(((1 - elapsed) * WINDOW_MS) / 1000)),
      };
    await r
      .multi()
      .incr(key(win))
      .pexpire(key(win), 2 * WINDOW_MS)
      .exec();
    return { ok: true };
  } catch (e) {
    warnFailOpen(e, now);
    return { ok: true };
  }
}

// Fail-open is deliberate (availability over limiting), but must be
// visible: one warning per minute at most while Redis stays down.
const FAIL_OPEN_WARN_MS = 60_000;
let lastFailOpenWarn = -Infinity;
export function warnFailOpen(
  err: unknown,
  now = Date.now(),
  log: Pick<typeof logger, "warn"> = logger,
): boolean {
  if (now - lastFailOpenWarn < FAIL_OPEN_WARN_MS) return false;
  lastFailOpenWarn = now;
  log.warn(
    { err },
    "ipRateLimit: Redis unavailable, per-IP limits disabled (fail-open)",
  );
  return true;
}

export class BodyTooLarge extends Error {}

// Capped body read (streaming): beyond `max` bytes, stop and
// BodyTooLarge, even without Content-Length (chunked upload).
export async function readBounded(
  req: Request,
  max = bodyMaxBytes(),
): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > max)
    throw new BodyTooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const tooLarge = () =>
  Response.json(
    { error: `Payload too large (max ${bodyMaxBytes()} bytes)` },
    { status: 413 },
  );
