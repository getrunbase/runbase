// Quotas and rate limits per workspace: number of records, runs started
// per minute, API calls (MCP, ingestion) per minute. Default values
// overridable per workspace (workspaces.limits column, Settings), within
// the organization entitlements (../entitlements):
// effective = min(preference, cap). Rate: fixed one-minute window in
// Redis (counter shared between web and worker instances).
import { and, eq, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { busConnection } from "../bus";
import { pages, workspaceUsage, workspaces } from "../db/schema";
import { db } from "../db/client";
import {
  entitlementsFor,
  fmt,
  QuotaError,
  quotaOf,
  type QuotaKey,
} from "../entitlements";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import { appError, errorItem } from "../errors/app-error";
import { env } from "../env";
import { getExtensions } from "../extensions";

export { QuotaError };

export type Limits = {
  records: number;
  runsPerMinute: number;
  apiPerMinute: number;
  // Jobs (run steps, bus events) executed at the same time for the
  // workspace, per queue. Default: quota:concurrency from entitlements,
  // otherwise QUOTA_CONCURRENCY; overridable per workspace.
  concurrency: number;
};

export const DEFAULT_LIMITS: Limits = {
  records: env().QUOTA_RECORDS,
  runsPerMinute: env().QUOTA_RUNS_PER_MINUTE,
  apiPerMinute: env().QUOTA_API_PER_MINUTE,
  concurrency: env().QUOTA_CONCURRENCY,
};

// Limits capped by entitlements (concurrency is only a default).
const CAPPED_KEYS = ["records", "runsPerMinute", "apiPerMinute"] as const;
type CappedKey = (typeof CAPPED_KEYS)[number];
const quotaKey = (k: CappedKey) => `quota:${k}` as QuotaKey;

// Effective caps (null = unlimited) and defaults, for an organization.
async function capsAndDefaults(organizationId: string) {
  const { quotas } = await entitlementsFor(organizationId);
  const caps = Object.fromEntries(
    CAPPED_KEYS.map((k) => [k, quotas[quotaKey(k)] ?? null]),
  ) as Record<CappedKey, number | null>;
  const defaults: Limits = {
    ...DEFAULT_LIMITS,
    concurrency: quotas["quota:concurrency"] ?? DEFAULT_LIMITS.concurrency,
  };
  return { caps, defaults };
}

const capped = (l: Limits, caps: Record<CappedKey, number | null>): Limits => ({
  ...l,
  ...Object.fromEntries(
    CAPPED_KEYS.map((k) => [k, caps[k] == null ? l[k] : Math.min(l[k], caps[k])]),
  ),
});

// Entitlement defaults, workspace overrides (take precedence), then caps.
export const resolveLimits = (
  defaults: Limits,
  overrides: Partial<Limits> | null | undefined,
  caps: Record<CappedKey, number | null>,
): Limits => capped({ ...defaults, ...overrides }, caps);

// Concurrency cap of a workspace, read on the worker side (outside tenant
// context) and cached for 30 s: one query per workspace, not per job.
const concurrencyCache = new Map<string, { n: number; at: number }>();
export async function tenantConcurrency(workspaceId: string) {
  const hit = concurrencyCache.get(workspaceId);
  if (hit && Date.now() - hit.at < 30_000) return hit.n;
  const [row] = await db
    .select({ limits: workspaces.limits, org: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  const { caps, defaults } = row
    ? await capsAndDefaults(row.org)
    : { caps: { records: null, runsPerMinute: null, apiPerMinute: null }, defaults: DEFAULT_LIMITS };
  const n = resolveLimits(defaults, row?.limits, caps).concurrency;
  concurrencyCache.set(workspaceId, { n, at: Date.now() });
  return n;
}

async function capsAndLimits(tx: Tx, ctx: TenantContext) {
  const [row] = await tx
    .select({ limits: workspaces.limits })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId));
  const { caps, defaults } = await capsAndDefaults(ctx.organizationId);
  return {
    caps,
    defaults: capped(defaults, caps),
    limits: resolveLimits(defaults, row?.limits, caps),
  };
}
const limitsIn = async (tx: Tx, ctx: TenantContext) =>
  (await capsAndLimits(tx, ctx)).limits;

// Limit read once per transaction: a batch does not reread it for each row.
const limitOf = new WeakMap<object, number>();

// To call before each record insert, in the write transaction.
// workspace_usage counter, kept up to date by trigger on each
// insert/delete: the conditional UPDATE locks the row until
// commit, concurrent writes of the workspace wait then see the
// updated count. No row returned = quota reached.
export async function checkRecordQuota(tx: Tx, ctx: TenantContext) {
  let max = limitOf.get(tx);
  if (max === undefined) {
    max = (await limitsIn(tx, ctx)).records;
    limitOf.set(tx, max);
    await tx
      .insert(workspaceUsage)
      .values({
        workspaceId: ctx.workspaceId,
        organizationId: ctx.organizationId,
      })
      .onConflictDoNothing();
  }
  const [row] = await tx
    .update(workspaceUsage)
    .set({ records: sql`${workspaceUsage.records}` })
    .where(
      and(
        eq(workspaceUsage.workspaceId, ctx.workspaceId),
        sql`${workspaceUsage.records} + 1 <= ${max}`,
      ),
    )
    .returning({ n: workspaceUsage.records });
  if (!row) {
    const it = errorItem(
      "quotas.records",
      "Quota reached: {max} records maximum in this workspace. Delete records or raise the quota in Settings.",
      { max: fmt(max) },
    );
    throw new QuotaError(it.message, it);
  }
}

let redis: Redis | undefined;
const kinds = {
  runs: { key: "runsPerMinute" },
  api: { key: "apiPerMinute" },
} as const;

// Counts a call in the current minute; refuses beyond the limit.
// Limits cached per workspace: no DB query
// on each limited call. Short TTL (a plan change applies within
// seconds); quotas.set invalidates the entry of the current instance,
// other instances follow at the latest after the TTL.
export const LIMITS_TTL_MS = env().QUOTA_LIMITS_TTL_MS;
const limitsCache = new Map<string, { at: number; limits: Promise<Limits> }>();
function cachedLimits(ctx: TenantContext) {
  const hit = limitsCache.get(ctx.workspaceId);
  if (hit && Date.now() - hit.at < LIMITS_TTL_MS) return hit.limits;
  const limits = withTenant(ctx, (tx) => limitsIn(tx, ctx));
  if (limitsCache.size > 10_000) limitsCache.clear();
  limitsCache.set(ctx.workspaceId, { at: Date.now(), limits });
  // Failure (DB unavailable): never cached.
  limits.catch(() => limitsCache.delete(ctx.workspaceId));
  return limits;
}

export async function rateLimit(ctx: TenantContext, kind: keyof typeof kinds) {
  const { key } = kinds[kind];
  const limits = await cachedLimits(ctx);
  const max = limits[key];
  const minute = Math.floor(Date.now() / 60_000);
  const k = `rl:${kind}:${ctx.workspaceId}:${minute}`;
  redis ??= busConnection();
  const [[, n]] = (await redis.multi().incr(k).expire(k, 120).exec()) as [
    [unknown, number],
  ];
  if (n > max) {
    const params = {
      max: fmt(max),
      wait: 60 - (Math.floor(Date.now() / 1000) % 60),
    };
    const it =
      kind === "runs"
        ? errorItem(
            "quotas.runsPerMinute",
            "Limit reached: {max} workflow runs per minute in this workspace. Retry in {wait} s or raise the limit in Settings.",
            params,
          )
        : errorItem(
            "quotas.apiPerMinute",
            "Limit reached: {max} API calls per minute in this workspace. Retry in {wait} s or raise the limit in Settings.",
            params,
          );
    throw new QuotaError(it.message, it);
  }
}

// Monthly run counter (workflow runs from any trigger, function calls
// outside workflows). Counted per workspace in workspace_usage, capped per
// organization by quota:runsPerMonth (sum of its workspaces for the current
// UTC month). Unlimited by default: no cap = no read, only the increment.
export const currentMonth = (now = new Date()) =>
  `${now.toISOString().slice(0, 7)}-01`;

export async function runsThisMonth(organizationId: string) {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${workspaceUsage.runs}), 0)::int` })
    .from(workspaceUsage)
    .where(
      and(
        eq(workspaceUsage.organizationId, organizationId),
        eq(workspaceUsage.runsMonth, currentMonth()),
      ),
    );
  return row?.n ?? 0;
}

// To call before a run starts: refuses beyond the cap, otherwise counts it.
// Check then increment (not atomic across workspaces): a few concurrent
// runs may overshoot the cap by a handful, never by more.
export async function countRun(ctx: TenantContext) {
  const max = await quotaOf(ctx.organizationId, "quota:runsPerMonth");
  if (Number.isFinite(max) && (await runsThisMonth(ctx.organizationId)) + 1 > max) {
    const it = errorItem(
      "quotas.runsPerMonth",
      "Quota reached: {max} runs per month for your account. Wait for next month or raise the quota.",
      { max: fmt(max) },
    );
    throw new QuotaError(it.message, it);
  }
  const month = currentMonth();
  await db
    .insert(workspaceUsage)
    .values({
      workspaceId: ctx.workspaceId,
      organizationId: ctx.organizationId,
      runs: 1,
      runsMonth: month,
    })
    .onConflictDoUpdate({
      target: workspaceUsage.workspaceId,
      set: {
        runs: sql`case when ${workspaceUsage.runsMonth} = ${month} then ${workspaceUsage.runs} + 1 else 1 end`,
        runsMonth: month,
      },
    });
}

// Stored file bytes: counted per workspace in workspace_usage (upload adds,
// delete subtracts), capped per organization by quota:storageBytes (sum of
// its workspaces). Unlimited by default: no cap = no read, only the update.
export async function storageBytesOf(organizationId: string) {
  const [row] = await db
    .select({
      n: sql<number>`coalesce(sum(${workspaceUsage.storageBytes}), 0)::bigint`,
    })
    .from(workspaceUsage)
    .where(eq(workspaceUsage.organizationId, organizationId));
  return Number(row?.n ?? 0);
}

// To call before storing a file of `bytes`: refuses beyond the cap,
// otherwise counts it. Same check-then-increment trade-off as countRun.
export async function countStorage(ctx: TenantContext, bytes: number) {
  const max = await quotaOf(ctx.organizationId, "quota:storageBytes");
  if (
    Number.isFinite(max) &&
    (await storageBytesOf(ctx.organizationId)) + bytes > max
  ) {
    const it = errorItem(
      "quotas.storageBytes",
      "Quota reached: {max} bytes of file storage for your account. Delete files or raise the quota.",
      { max: fmt(max) },
    );
    throw new QuotaError(it.message, it);
  }
  await addStorage(ctx, bytes);
}

// Adds (or subtracts, negative) stored bytes; never below zero.
export async function addStorage(ctx: TenantContext, bytes: number) {
  await db
    .insert(workspaceUsage)
    .values({
      workspaceId: ctx.workspaceId,
      organizationId: ctx.organizationId,
      storageBytes: Math.max(0, bytes),
    })
    .onConflictDoUpdate({
      target: workspaceUsage.workspaceId,
      set: {
        storageBytes: sql`greatest(0, ${workspaceUsage.storageBytes} + ${bytes})`,
      },
    });
}

// Page useAI: AI calls per minute, cap per workspace and
// per page (a public page alone does not drain the workspace window).
export const AI_PER_MINUTE = { workspace: 60, page: 20 };
export async function rateLimitAi(ctx: TenantContext, pageId: string) {
  const minute = Math.floor(Date.now() / 60_000);
  const kw = `rl:ai:${ctx.workspaceId}:${minute}`;
  const kp = `rl:ai:${ctx.workspaceId}:${pageId}:${minute}`;
  redis ??= busConnection();
  const res = (await redis
    .multi()
    .incr(kw)
    .expire(kw, 120)
    .incr(kp)
    .expire(kp, 120)
    .exec()) as [unknown, number][];
  const max =
    res[0]![1] > AI_PER_MINUTE.workspace
      ? AI_PER_MINUTE.workspace
      : res[2]![1] > AI_PER_MINUTE.page
        ? AI_PER_MINUTE.page
        : 0;
  if (max) {
    const it = errorItem(
      "quotas.aiPerMinute",
      "Limit reached: {max} AI calls per minute. Retry in {wait} s.",
      { max: fmt(max), wait: 60 - (Math.floor(Date.now() / 1000) % 60) },
    );
    throw new QuotaError(it.message, it);
  }
}

export const exceedsLimit = (key: string, value: number, max: number) =>
  appError(
    "quotas.exceedsLimit",
    "{key}: {value} exceeds your account limit ({max}). Contact your administrator to raise it.",
    { key, value: fmt(value), max: fmt(max) },
    { kind: "quota_exceeded" },
  );


export const quotasService = {
  // Effective limits and current usage.
  get: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const { limits, defaults, caps } = await capsAndLimits(tx, ctx);
      const [row] = await tx
        .select({
          n: workspaceUsage.records,
          runs: workspaceUsage.runs,
          month: workspaceUsage.runsMonth,
          storageBytes: workspaceUsage.storageBytes,
        })
        .from(workspaceUsage)
        .where(eq(workspaceUsage.workspaceId, ctx.workspaceId));
      return {
        limits,
        defaults,
        caps,
        usage: {
          records: row?.n ?? 0,
          // Runs of this workspace in the current UTC month.
          runsThisMonth: row?.month === currentMonth() ? row.runs : 0,
          // Bytes of attached files stored by this workspace.
          storageBytes: row?.storageBytes ?? 0,
        },
      };
    });
  },
  // Workspace overrides (owners/admins); a missing value = default.
  set: async (ctx: TenantContext, input: Partial<Limits>) => {
    await requireScope(ctx, "admin");
    const limits = Object.fromEntries(
      Object.entries(input).filter(
        ([k, v]) =>
          k in DEFAULT_LIMITS && Number.isInteger(v) && (v as number) > 0,
      ),
    );
    await withTenant(ctx, async (tx) => {
      // Never beyond entitlements: the tenant does not raise its own caps.
      const { caps } = await capsAndDefaults(ctx.organizationId);
      for (const k of CAPPED_KEYS) {
        const v = limits[k] as number | undefined;
        const max = caps[k];
        if (v !== undefined && max != null && v > max) throw exceedsLimit(k, v, max);
      }
      await tx
        .update(workspaces)
        .set({ limits })
        .where(eq(workspaces.id, ctx.workspaceId));
      await audit(
        tx,
        ctx,
        "workspace.limits",
        { type: "workspace", id: ctx.workspaceId },
        limits,
      );
    });
    limitsCache.delete(ctx.workspaceId);
    concurrencyCache.delete(ctx.workspaceId);
    return quotasService.get(ctx);
  },
};

// Settings › Plan and usage: plan provided by the extension and
// used / cap counters (null = unlimited). null without extension.
export type UsageItem = {
  key: "records" | "workspaces" | "pages";
  used: number;
  limit: number | null;
};

export const billingService = {
  // Does the extension provide a plan? (tab shown or not)
  enabled: () => typeof getExtensions().billing.account === "function",
  get: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const account =
      (await getExtensions().billing.account?.(ctx.organizationId)) ?? null;
    if (!account) return null;
    const { quotas } = await entitlementsFor(ctx.organizationId);
    const usage = await withTenant(ctx, async (tx) => {
      const [rec] = await tx
        .select({ n: workspaceUsage.records })
        .from(workspaceUsage)
        .where(eq(workspaceUsage.workspaceId, ctx.workspaceId));
      const [ws] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(workspaces)
        .where(eq(workspaces.organizationId, ctx.organizationId))) as [
        { n: number },
      ];
      return { records: rec?.n ?? 0, workspaces: ws.n };
    });
    // Published pages of the whole organization (RLS would scope the
    // tenant transaction to one workspace).
    const [pub] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(pages)
      .where(
        and(
          eq(pages.organizationId, ctx.organizationId),
          sql`${pages.currentVersion} is not null`,
        ),
      )) as [{ n: number }];
    const limit = (k: QuotaKey) => quotas[k] ?? null;
    const items: UsageItem[] = [
      { key: "records", used: usage.records, limit: limit("quota:records") },
      {
        key: "workspaces",
        used: usage.workspaces,
        limit: limit("quota:workspaces"),
      },
      { key: "pages", used: pub.n, limit: limit("quota:pages") },
    ];
    return {
      plan: account.plan,
      checkoutUrl: account.checkoutUrl ?? null,
      portalUrl: account.portalUrl ?? null,
      items,
    };
  },
};

// Quota error (to show a link to Plan and usage).
export const isQuotaError = (e: unknown) =>
  (e as { kind?: string } | null)?.kind === "quota_exceeded";
