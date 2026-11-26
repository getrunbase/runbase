// Integration test: requires DATABASE_URL (and Redis for usage).
// Settings role matrix: owner/admin manage the organization settings,
// members only read usage, viewers see none of it.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { apiKeyContext, apiKeysService } from "../api-keys";
import { auditService } from "../audit";
import { registerExtensions, resetExtensions } from "../extensions";
import { billingService, quotasService, usageService } from "../quotas";
import { runsService } from "../runs";
import { secretsService } from "../secrets";
import { workspacesService } from "../workspaces";
import { membersService, requireOwner } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));
afterEach(() => resetExtensions());

type Role = "owner" | "admin" | "member" | "viewer";

// One organization with one user per role.
type Scope = "read" | "write" | "admin";
type Org = Record<Role, TenantContext> & {
  key: (s: Scope[]) => Promise<TenantContext>;
};
async function org(): Promise<Org> {
  const [o] =
    await sql`insert into organizations (name) values ('roles test') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${o!.id}, 'Default') returning id`;
  const ctx = async (role: Role): Promise<TenantContext> => {
    const uid = crypto.randomUUID();
    await sql`insert into "user" (id, name, email) values (${uid}, ${role}, ${uid + "@x.io"})`;
    await sql`insert into memberships (user_id, organization_id, role, accepted_at) values (${uid}, ${o!.id}, ${role}, now())`;
    return {
      organizationId: o!.id,
      workspaceId: ws!.id,
      actor: { userId: uid },
    };
  };
  const owner = await ctx("owner");
  return {
    owner,
    admin: await ctx("admin"),
    member: await ctx("member"),
    viewer: await ctx("viewer"),
    // Real API key of the organization with these scopes.
    key: async (scopes) => {
      const { id } = await apiKeysService.create(owner, {
        name: scopes.join("+"),
        scopes,
        workspaceIds: [ws!.id],
      });
      return (await apiKeyContext(id, ws!.id))!;
    },
  };
}

const denied = /scope|owner/i;

const billingExtension = () =>
  registerExtensions({
    billing: {
      entitlements: async () => ({ features: [], quotas: {} }),
      reportUsage: async () => {},
      account: async () => ({
        plan: "Test",
        portalUrl: "https://example.test/portal",
      }),
      plans: async () => ({
        current: "p",
        plans: [{ id: "p", name: "P", highlights: [], prices: [] }],
      }),
    },
  } as never);

// Admin-only reads of the Settings areas.
const adminReads: [string, (c: TenantContext) => Promise<unknown>][] = [
  ["membersService.list", (c) => membersService.list(c)],
  ["auditService.list", (c) => auditService.list(c)],
  ["quotasService.get", (c) => quotasService.get(c)],
  ["runsService.budget", (c) => runsService.budget(c)],
  ["billingService.get", (c) => billingService.get(c)],
  ["billingService.plans", (c) => billingService.plans(c)],
];

for (const [name, call] of adminReads) {
  test(`${name}: owner and admin allowed, member and viewer refused`, async () => {
    billingExtension();
    const o = await org();
    await call(o.owner);
    await call(o.admin);
    await assert.rejects(call(o.member), denied);
    await assert.rejects(call(o.viewer), denied);
    // API keys keep their scope semantics.
    await call(await o.key(["admin"]));
    await assert.rejects(call(await o.key(["read", "write"])), denied);
  });
}

test("usageService.get: member allowed, viewer refused", async () => {
  const o = await org();
  for (const c of [o.owner, o.admin, o.member, await o.key(["write"])])
    assert.ok(Array.isArray(await usageService.get(c)));
  await assert.rejects(usageService.get(o.viewer), denied);
  await assert.rejects(usageService.get(await o.key(["read"])), denied);
});

test("billing portal link: owner only", async () => {
  billingExtension();
  const o = await org();
  assert.equal(
    (await billingService.get(o.owner))?.portalUrl,
    "https://example.test/portal",
  );
  assert.equal((await billingService.get(o.admin))?.portalUrl, null);
  assert.equal(
    (await billingService.get(await o.key(["admin"])))?.portalUrl,
    null,
  );
});

test("requireOwner: refuses admin, member, viewer and API keys", async () => {
  const o = await org();
  await requireOwner(o.owner);
  for (const c of [o.admin, o.member, o.viewer, await o.key(["admin"])])
    await assert.rejects(requireOwner(c), denied);
});

test("member work stays readable: workspace switcher, secret names, record history", async () => {
  const o = await org();
  for (const c of [o.member, o.viewer]) {
    assert.equal((await workspacesService.list(c)).length, 1);
    // Workflow and function editors need the secret names (never values).
    assert.ok(Array.isArray(await secretsService.list(c)));
    assert.ok(
      Array.isArray(
        await auditService.history(c, { type: "workspace", id: c.workspaceId }),
      ),
    );
  }
});
