// Entitlements: features and caps per organization, provided
// by the billing extension. Without extension: env caps,
// unlimited by default, all features allowed. The core knows
// no plan name: changing a plan does not touch this repo.
// Adding a quota type remains a public change (its counter).
import { env } from "../env";
import { getExtensions } from "../extensions";
import { AppError, errorItem, type ErrorInfo } from "../errors/app-error";
import type { TenantContext } from "../tenant";

export const QUOTA_KEYS = [
  "quota:records",
  "quota:runsPerMinute",
  "quota:apiPerMinute",
  "quota:concurrency",
  "quota:workspaces",
  "quota:aiBudgetUsd",
  "quota:retentionDays",
] as const;
export type QuotaKey = (typeof QUOTA_KEYS)[number];
export type FeatureKey = `feat:${string}`;

// features null = everything allowed (no extension or extension without an opinion).
export type Resolved = { features: string[] | null; quotas: Record<string, number> };

export function envEntitlements(): Resolved {
  const e = env();
  const q: Record<string, number | undefined> = {
    "quota:records": e.QUOTA_MAX_RECORDS,
    "quota:runsPerMinute": e.QUOTA_MAX_RUNS_PER_MINUTE,
    "quota:apiPerMinute": e.QUOTA_MAX_API_PER_MINUTE,
    "quota:workspaces": e.QUOTA_MAX_WORKSPACES,
    "quota:aiBudgetUsd": e.QUOTA_MAX_AI_BUDGET_USD,
    "quota:retentionDays": e.RETENTION_DAYS,
  };
  return {
    features: null,
    quotas: Object.fromEntries(
      Object.entries(q).filter((x): x is [string, number] => x[1] != null),
    ),
  };
}

// Short cache per organization: one extension call per TTL, not per request.
const cache = new Map<string, { at: number; v: Promise<Resolved> }>();
export const invalidateEntitlements = (organizationId?: string) => {
  if (organizationId) cache.delete(organizationId);
  else cache.clear();
};

export function entitlementsFor(organizationId: string): Promise<Resolved> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < env().QUOTA_LIMITS_TTL_MS) return hit.v;
  const v = getExtensions()
    .billing.entitlements(organizationId)
    .then((x): Resolved => {
      const base = envEntitlements();
      if (!x) return base;
      // Extension quotas take precedence; env fills in the ones it omits.
      return { features: x.features, quotas: { ...base.quotas, ...x.quotas } };
    });
  if (cache.size > 10_000) cache.clear();
  cache.set(organizationId, { at: Date.now(), v });
  v.catch(() => cache.delete(organizationId));
  return v;
}

// Cap of a quota; Infinity = unlimited.
export async function quotaOf(organizationId: string, key: QuotaKey) {
  return (await entitlementsFor(organizationId)).quotas[key] ?? Infinity;
}

export async function can(
  ctx: Pick<TenantContext, "organizationId">,
  feature: FeatureKey,
) {
  const { features } = await entitlementsFor(ctx.organizationId);
  return features == null || features.includes(feature);
}

// Exceeded: clear message (what, how much, what to do), HTTP status 429.
export class QuotaError extends AppError {
  status = 429 as const;
  constructor(message: string, info: ErrorInfo = { code: "quotas.exceeded" }) {
    super(info.code, message, info.params, { kind: "quota_exceeded" });
  }
}

export const fmt = (n: number) => n.toLocaleString("en-US");

// Refuses if `next` (usage after the operation) exceeds the cap. Returns the cap.
export async function checkQuota(
  ctx: Pick<TenantContext, "organizationId">,
  key: QuotaKey,
  next: number,
) {
  const max = await quotaOf(ctx.organizationId, key);
  if (next > max) {
    const it = errorItem(
      "quotas.limit",
      "Limit reached: {quota} is capped at {max} for your account. Contact your administrator to raise it.",
      { quota: key.slice(6), max: fmt(max) },
    );
    throw new QuotaError(it.message, it);
  }
  return max;
}
