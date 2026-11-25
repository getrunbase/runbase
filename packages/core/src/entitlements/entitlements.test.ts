// Entitlements: env caps without extension, extension precedence, features,
// per-organization cache and quota errors. No database.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  can,
  checkQuota,
  entitlementsFor,
  envEntitlements,
  invalidateEntitlements,
  quotaOf,
  QuotaError,
} from "./index";
import { registerExtensions, resetExtensions } from "../extensions";

afterEach(() => {
  resetExtensions();
  invalidateEntitlements();
});

const billing = (
  entitlements: (org: string) => Promise<{
    features: string[];
    quotas: Record<string, number>;
  } | null>,
) =>
  registerExtensions({
    billing: { entitlements, reportUsage: async () => {} },
  });

test("without extension: every feature allowed, env caps only", async () => {
  const org = crypto.randomUUID();
  assert.equal(await can({ organizationId: org }, "feat:anything"), true);
  assert.deepEqual(await entitlementsFor(org), envEntitlements());
  assert.equal(await quotaOf(org, "quota:concurrency"), Infinity);
});

test("extension: features restrict, quotas override env per organization", async () => {
  billing(async (org) =>
    org === "pro"
      ? { features: ["feat:pages"], quotas: { "quota:workspaces": 10 } }
      : { features: [], quotas: { "quota:workspaces": 1 } },
  );
  assert.equal(await can({ organizationId: "pro" }, "feat:pages"), true);
  assert.equal(await can({ organizationId: "free" }, "feat:pages"), false);
  assert.equal(await quotaOf("pro", "quota:workspaces"), 10);
  assert.equal(await quotaOf("free", "quota:workspaces"), 1);
});

test("extension without an opinion falls back to env", async () => {
  billing(async () => null);
  assert.equal(await can({ organizationId: "o" }, "feat:x"), true);
  assert.deepEqual(await entitlementsFor("o"), envEntitlements());
});

test("cached per organization until invalidated", async () => {
  let calls = 0;
  billing(async () => {
    calls++;
    return { features: [], quotas: {} };
  });
  await entitlementsFor("c");
  await entitlementsFor("c");
  assert.equal(calls, 1);
  invalidateEntitlements("c");
  await entitlementsFor("c");
  assert.equal(calls, 2);
});

test("a failing extension is not cached", async () => {
  let fail = true;
  billing(async () => {
    if (fail) throw new Error("billing down");
    return { features: [], quotas: { "quota:records": 5 } };
  });
  await assert.rejects(entitlementsFor("f"), /billing down/);
  fail = false;
  await new Promise((r) => setImmediate(r));
  assert.equal(await quotaOf("f", "quota:records"), 5);
});

test("checkQuota: allows up to the cap, then a 429 QuotaError", async () => {
  billing(async () => ({ features: [], quotas: { "quota:records": 2 } }));
  const ctx = { organizationId: "q" };
  assert.equal(await checkQuota(ctx, "quota:records", 2), 2);
  await assert.rejects(checkQuota(ctx, "quota:records", 3), (e) => {
    assert.ok(e instanceof QuotaError);
    assert.equal(e.status, 429);
    assert.equal(e.code, "quotas.limit");
    return true;
  });
});

test("checkQuota: points to a plan upgrade when the host provides billing.account", async () => {
  registerExtensions({
    billing: {
      entitlements: async () => ({ features: [], quotas: { "quota:records": 1 } }),
      reportUsage: async () => {},
      account: async () => ({ plan: "Test" }),
    },
  });
  await assert.rejects(checkQuota({ organizationId: "u" }, "quota:records", 2), (e) => {
    assert.ok(e instanceof QuotaError);
    assert.equal(e.code, "quotas.limitUpgrade");
    assert.match(e.message, /Upgrade your plan/);
    assert.doesNotMatch(e.message, /administrator/);
    return true;
  });
});
