// Badge visibility: live view only, hidden by the `feat:hideBadge`
// entitlement, hidden without billing extension (self-host).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { invalidateEntitlements } from "@getrunbase/core/entitlements";
import { registerExtensions, resetExtensions } from "@getrunbase/core/extensions";
import { showBadge } from "./badge";

afterEach(() => {
  resetExtensions();
  invalidateEntitlements();
});

const withFeatures = (features: string[]) =>
  registerExtensions({
    billing: {
      entitlements: async () => ({ features, quotas: {} }),
      reportUsage: async () => {},
    },
  });

const live = { draft: false, shot: false };
const ctx = () => ({ organizationId: crypto.randomUUID() });

test("self-host (no extension): badge hidden", async () => {
  assert.equal(await showBadge(ctx(), live), false);
});

test("extension without feat:hideBadge: badge shown on live view", async () => {
  withFeatures([]);
  assert.equal(await showBadge(ctx(), live), true);
});

test("feat:hideBadge granted: badge hidden", async () => {
  withFeatures(["feat:hideBadge"]);
  assert.equal(await showBadge(ctx(), live), false);
});

test("draft or screenshot: badge never shown", async () => {
  withFeatures([]);
  assert.equal(await showBadge(ctx(), { draft: true, shot: false }), false);
  assert.equal(await showBadge(ctx(), { draft: false, shot: true }), false);
});

test("builder inside the app: badge never shown", async () => {
  withFeatures([]);
  assert.equal(await showBadge(ctx(), { ...live, builder: true }), false);
});
