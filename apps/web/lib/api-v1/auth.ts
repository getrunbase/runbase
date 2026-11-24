// API v1: API key authentication (`Authorization: Bearer agk_…`,
// optional workspace in `x-workspace-id`) and per-key rate limit.
import type { Redis } from "ioredis";
import { authenticateApiKey } from "@getrunbase/core/api-keys";
import { busConnection } from "@getrunbase/core/bus";
import { appError } from "@getrunbase/core/errors";
import { rateLimit } from "@getrunbase/core/quotas";
import type { TenantContext } from "@getrunbase/core/tenant";

// Requests per minute per key (fixed Redis window, shared between instances).
const perMinute = () => Number(process.env.API_V1_RATE_LIMIT ?? 600);

let redis: Redis | undefined;

export type RateHeaders = Record<string, string>;

// Error carrying HTTP headers (429: Retry-After).
export const withHeaders = <E extends Error>(e: E, headers: RateHeaders) =>
  Object.assign(e, { headers });

export async function limitKey(apiKeyId: string): Promise<RateHeaders> {
  const max = perMinute();
  const now = Date.now();
  const k = `rl:api-v1:${apiKeyId}:${Math.floor(now / 60_000)}`;
  redis ??= busConnection();
  const res = await redis.multi().incr(k).expire(k, 120).exec();
  const n = Number(res?.[0]?.[1] ?? 0);
  const wait = 60 - (Math.floor(now / 1000) % 60);
  const headers = {
    "x-ratelimit-limit": String(max),
    "x-ratelimit-remaining": String(Math.max(max - n, 0)),
    "x-ratelimit-reset": String(wait),
  };
  if (n > max)
    throw withHeaders(
      appError(
        "api.rateLimited",
        "Rate limit exceeded: {max} requests per minute for this API key. Retry in {wait} s.",
        { max, wait },
        { kind: "quota_exceeded" },
      ),
      { ...headers, "retry-after": String(wait) },
    );
  return headers;
}

// Request tenant context, after the per-key limit then the workspace API quota.
export async function authenticate(
  req: Request,
): Promise<{ ctx: TenantContext; headers: RateHeaders }> {
  const key = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key)
    throw appError(
      "api.missingKey",
      "Missing API key: send the header Authorization: Bearer <key>",
      {},
      { kind: "unauthorized" },
    );
  const ctx = await authenticateApiKey(
    key,
    req.headers.get("x-workspace-id") || undefined,
  );
  const headers = await limitKey(
    "apiKeyId" in ctx.actor ? ctx.actor.apiKeyId : "",
  );
  await rateLimit(ctx, "api");
  return { ctx, headers };
}
