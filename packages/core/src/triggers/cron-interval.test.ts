// Minimum cron interval: computation and the quota:cronMinIntervalSec cap.
// No database.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { checkCronInterval, cronMinIntervalSec } from "./cron-interval";
import { invalidateEntitlements, QuotaError } from "../entitlements";
import { registerExtensions, resetExtensions } from "../extensions";

afterEach(() => {
  resetExtensions();
  invalidateEntitlements();
});

const withMin = (sec: number) =>
  registerExtensions({
    billing: {
      entitlements: async () => ({
        features: [],
        quotas: { "quota:cronMinIntervalSec": sec },
      }),
      reportUsage: async () => {},
    },
  });

test("interval: regular, irregular and seconds patterns", () => {
  assert.equal(cronMinIntervalSec("* * * * *"), 60);
  assert.equal(cronMinIntervalSec("*/15 * * * *"), 900);
  assert.equal(cronMinIntervalSec("0,1 * * * *"), 60);
  assert.equal(cronMinIntervalSec("*/10 * * * * *"), 10);
  assert.equal(cronMinIntervalSec("0 9 * * 1-5", "Europe/Paris"), 86400);
});

test("invalid cron: clear error", () => {
  assert.throws(
    () => cronMinIntervalSec("not a cron"),
    (e: Error & { code?: string }) => e.code === "triggers.invalidCron",
  );
});

test("no entitlement: no minimum (self-host unchanged)", async () => {
  const ctx = { organizationId: crypto.randomUUID() };
  await checkCronInterval(ctx, "* * * * * *");
});

test("entitlement: rejects schedules more frequent than the minimum", async () => {
  withMin(900);
  const ctx = { organizationId: crypto.randomUUID() };
  await assert.rejects(
    checkCronInterval(ctx, "*/5 * * * *"),
    (e: QuotaError) =>
      e instanceof QuotaError &&
      e.code === "quotas.cronMinInterval" &&
      e.status === 429,
  );
  await checkCronInterval(ctx, "*/15 * * * *");
  await checkCronInterval(ctx, "0 * * * *");
});
