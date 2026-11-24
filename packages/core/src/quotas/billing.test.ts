// Plan and usage: page missing without extension, counters otherwise.
// Requires DATABASE_URL (like usage.test.ts).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { invalidateEntitlements, QuotaError } from "../entitlements";
import { registerExtensions, resetExtensions } from "../extensions";
import type { TenantContext } from "../tenant";
import { billingService, isQuotaError } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));
afterEach(() => {
  resetExtensions();
  invalidateEntitlements();
});

async function owner(): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values ('billing test') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'w') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'B', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return { organizationId: org!.id, workspaceId: ws!.id, actor: { userId: uid } };
}

test("self-host without extension: no page", async () => {
  assert.equal(billingService.enabled(), false);
  assert.equal(await billingService.get(await owner()), null);
});

test("extension: plan, links and counters (unlimited = null)", async () => {
  registerExtensions({
    billing: {
      entitlements: async () => ({ features: [], quotas: { "quota:workspaces": 3 } }),
      reportUsage: async () => {},
      account: async () => ({ plan: "Test", portalUrl: "https://example.test/portal" }),
    },
  });
  assert.equal(billingService.enabled(), true);
  const b = await billingService.get(await owner());
  assert.equal(b?.plan, "Test");
  assert.equal(b?.checkoutUrl, null);
  assert.equal(b?.portalUrl, "https://example.test/portal");
  const ws = b?.items.find((i) => i.key === "workspaces");
  assert.deepEqual(ws, { key: "workspaces", used: 1, limit: 3 });
  assert.equal(b?.items.find((i) => i.key === "records")?.limit ?? null, null);
});

test("isQuotaError", () => {
  assert.equal(isQuotaError(new QuotaError("x")), true);
  assert.equal(isQuotaError(new Error("x")), false);
  assert.equal(isQuotaError(null), false);
});
