// Minimum interval of a schedule trigger, capped by the
// `quota:cronMinIntervalSec` entitlement (unset = no minimum).
import { CronExpressionParser } from "cron-parser";
import { appError, errorItem } from "../errors/app-error";
import { fmt, quotaOf, QuotaError } from "../entitlements";
import type { TenantContext } from "../tenant";

// Sampled occurrences: enough to catch irregular patterns (e.g. `0,1 * * * *`).
const SAMPLES = 200;

// Shortest gap (seconds) between two consecutive runs of `cron`.
export function cronMinIntervalSec(cron: string, tz?: string) {
  let it;
  try {
    it = CronExpressionParser.parse(cron, { tz: tz ?? "UTC" });
  } catch {
    throw appError("triggers.invalidCron", "Invalid cron expression: {cron}", {
      cron,
    });
  }
  let prev = it.next().getTime();
  let min = Infinity;
  for (let i = 0; i < SAMPLES && it.hasNext(); i++) {
    const t = it.next().getTime();
    min = Math.min(min, t - prev);
    prev = t;
  }
  return min / 1000;
}

// Refuses a schedule more frequent than the account allows.
export async function checkCronInterval(
  ctx: Pick<TenantContext, "organizationId">,
  cron: string,
  tz?: string,
) {
  const min = await quotaOf(ctx.organizationId, "quota:cronMinIntervalSec");
  if (!Number.isFinite(min)) return;
  const interval = cronMinIntervalSec(cron, tz);
  if (interval < min) {
    const it = errorItem(
      "quotas.cronMinInterval",
      "Schedule too frequent: runs every {interval} s, the minimum interval for your account is {min} s. Choose a less frequent schedule.",
      { interval: fmt(interval), min: fmt(min) },
    );
    throw new QuotaError(it.message, it);
  }
}
