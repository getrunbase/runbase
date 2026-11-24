// Workspaces: tenant isolation, quota on creation, last workspace kept,
// secrets moved to the vault. Requires DATABASE_URL.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { invalidateEntitlements } from "../entitlements";
import { registerExtensions, resetExtensions } from "../extensions";
import type { TenantContext } from "../tenant";
import { mergeSettings, workspaceSettings, workspacesService } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));
afterEach(() => {
  resetExtensions();
  invalidateEntitlements();
});

async function owner(name: string): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'main') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, ${name}, ${uid + "@example.com"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

test("an organization never sees nor changes another one's workspaces", async () => {
  const a = await owner("ws iso A");
  const b = await owner("ws iso B");
  const created = await workspacesService.create(a, "A second");
  // B keeps two workspaces so remove() reaches the RLS filter.
  await workspacesService.create(b, "B second");
  const seen = (await workspacesService.list(b)).map((w) => w.id);
  assert.ok(!seen.includes(created.id));
  assert.ok(!seen.includes(a.workspaceId));
  assert.deepEqual(await workspacesService.rename(b, created.id, "hijack"), []);
  assert.deepEqual(await workspacesService.remove(b, created.id), []);
  const mine = await workspacesService.list(a);
  assert.equal(mine.find((w) => w.id === created.id)?.name, "A second");
});

test("creation is capped by quota:workspaces", async () => {
  registerExtensions({
    billing: {
      entitlements: async () => ({
        features: [],
        quotas: { "quota:workspaces": 2 },
      }),
      reportUsage: async () => {},
    },
  });
  const a = await owner("ws quota");
  await workspacesService.create(a, "two");
  await assert.rejects(
    workspacesService.create(a, "three"),
    (e: Error & { code?: string }) => e.code === "quotas.limit",
  );
  assert.equal((await workspacesService.list(a)).length, 2);
});

test("the last workspace cannot be deleted", async () => {
  const a = await owner("ws last");
  await assert.rejects(
    workspacesService.remove(a, a.workspaceId),
    (e: Error & { code?: string }) => e.code === "workspaces.lastNotDeletable",
  );
  const extra = await workspacesService.create(a, "extra");
  assert.equal((await workspacesService.remove(a, extra.id)).length, 1);
});

test("settings: secrets go to the vault, not to the settings column", async () => {
  const a = await owner("ws settings");
  await workspacesService.setSettings(a, {
    allowedDomains: ["api.example.com"],
    secrets: { TOKEN: "s3cret" },
  });
  const [row] =
    await sql`select settings from workspaces where id = ${a.workspaceId}`;
  assert.deepEqual((row!.settings as { secrets: unknown }).secrets, {});
  const s = await workspaceSettings(a);
  assert.deepEqual(s.allowedDomains, ["api.example.com"]);
  assert.equal(s.secrets.TOKEN, "s3cret");
});

test("settings: partial update keeps the AI provider and other keys", async () => {
  const a = await owner("ws merge");
  await sql`update workspaces set settings = ${sql.json({
    ai: { provider: "openai", model: "gpt-6-luna" },
    allowedDomains: ["a.example.com"],
    mcpServers: { one: { url: "https://one.example.com" } },
  })} where id = ${a.workspaceId}`;
  await workspacesService.setSettings(a, {
    mcpServers: { two: { url: "https://two.example.com" } },
  });
  const [row] =
    await sql`select settings from workspaces where id = ${a.workspaceId}`;
  const s = row!.settings as Record<string, unknown>;
  assert.deepEqual(s.ai, { provider: "openai", model: "gpt-6-luna" });
  assert.deepEqual(s.allowedDomains, ["a.example.com"]);
  assert.deepEqual(Object.keys(s.mcpServers as object).sort(), ["one", "two"]);
});

test("mergeSettings: deep merge of objects, arrays replaced", () => {
  assert.deepEqual(
    mergeSettings(
      { ai: { provider: "openai", model: "m" }, list: [1, 2] },
      { ai: { model: "n" }, list: [3] },
    ),
    { ai: { provider: "openai", model: "n" }, list: [3] },
  );
});
