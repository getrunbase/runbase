// useAI for pages: cost guard. Mocked DeepSeek (fetch);
// DATABASE_URL, REDIS_URL and SECRETS_MASTER_KEY required.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { pageAi } from "./ai";
import { registerExtensions, resetExtensions } from "./extensions";
import { invalidateEntitlements } from "./entitlements";
import { handleSdkCall, permissionsSchema } from "./components/sdk";
import { AI_PER_MINUTE } from "./quotas";
import { secretsService } from "./secrets";
import { aiSettingsService } from "./ai-providers";
import type { TenantContext } from "./tenant";

const keys: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  if (!String(url).startsWith("https://api.deepseek.com/"))
    return realFetch(url, init);
  keys.push(
    String((init.headers as Record<string, string>).authorization).replace(
      "Bearer ",
      "",
    ),
  );
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 10, completion_tokens: 100 },
    }),
  );
}) as typeof fetch;
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => {
  globalThis.fetch = realFetch;
  setImmediate(() => process.exit(0));
});

async function owner(): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values ('A') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name, settings) values (${org!.id}, 'W', '{"ai":{"provider":"deepseek"}}') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'U', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}
const month = () => new Date().toISOString().slice(0, 7);
const code = (e: unknown) => (e as { code?: string }).code;
const page = () => crypto.randomUUID();

test("useAI: workspace budget exhausted -> ai.budgetExceeded, no call", async () => {
  const ctx = await owner();
  await sql`update workspaces set ai_budget_usd = 1, ai_spent_usd = 1.5, ai_spent_month = ${month()} where id = ${ctx.workspaceId}`;
  const n = keys.length;
  await assert.rejects(pageAi(ctx, page(), { prompt: "hi" }), (e) => {
    assert.equal(code(e), "ai.budgetExceeded");
    return true;
  });
  assert.equal(keys.length, n);
});

test("useAI: entitlement cap applied without tenant preference", async () => {
  const ctx = await owner();
  registerExtensions({
    billing: {
      entitlements: async () => ({ features: [], quotas: { "quota:aiBudgetUsd": 2 } }),
      reportUsage: async () => {},
    },
  });
  invalidateEntitlements();
  try {
    await sql`update workspaces set ai_spent_usd = 3, ai_spent_month = ${month()} where id = ${ctx.workspaceId}`;
    await assert.rejects(pageAi(ctx, page(), { prompt: "hi" }), (e) => {
      assert.equal(code(e), "ai.budgetExceeded");
      return true;
    });
  } finally {
    resetExtensions();
    invalidateEntitlements();
  }
});

test("useAI: tenant key used, never the platform key", async () => {
  const ctx = await owner();
  await secretsService.set(ctx, "DEEPSEEK_API_KEY", "cle-tenant");
  const r = await pageAi(ctx, page(), { prompt: "hi" });
  assert.equal(r.text, "ok");
  assert.equal(keys.at(-1), "cle-tenant");
});

test("useAI: secret chosen from the vault, resolved server-side", async () => {
  const ctx = await owner();
  await secretsService.set(ctx, "MA_CLE_DS", "cle-choisie");
  await aiSettingsService.set(ctx, { provider: "deepseek", keySecret: "MA_CLE_DS" });
  const got = await aiSettingsService.get(ctx);
  assert.equal(got.keySecret, "MA_CLE_DS");
  assert.ok(!JSON.stringify(got).includes("cle-choisie"));
  await pageAi(ctx, page(), { prompt: "hi" });
  assert.equal(keys.at(-1), "cle-choisie");
});

// The platform never provides AI.
test("useAI: no tenant key -> ai.providerKeyMissing, no call", async () => {
  const ctx = await owner();
  const n = keys.length;
  await assert.rejects(pageAi(ctx, page(), { prompt: "hi" }), (e) => {
    assert.equal(code(e), "ai.providerKeyMissing");
    return true;
  });
  assert.equal(keys.length, n);
});

test("useAI: rate limit per page then per workspace", async () => {
  const ctx = await owner();
  await secretsService.set(ctx, "DEEPSEEK_API_KEY", "cle-tenant");
  const p = page();
  for (let i = 0; i < AI_PER_MINUTE.page; i++)
    await pageAi(ctx, p, { prompt: "hi" });
  await assert.rejects(pageAi(ctx, p, { prompt: "hi" }), (e) => {
    assert.equal(code(e), "quotas.aiPerMinute");
    return true;
  });
  // Other pages: workspace cap (calls already counted: page + 1).
  const left = AI_PER_MINUTE.workspace - AI_PER_MINUTE.page - 1;
  for (let i = 0; i < left; i++) await pageAi(ctx, page(), { prompt: "hi" });
  await assert.rejects(pageAi(ctx, page(), { prompt: "hi" }), (e) => {
    assert.equal(code(e), "quotas.aiPerMinute");
    return true;
  });
});

test("useAI: undeclared ai permission -> refused before any call", async () => {
  const ctx = await owner();
  await secretsService.set(ctx, "DEEPSEEK_API_KEY", "cle-tenant");
  const n = keys.length;
  const host = { def: {} as never, scope: {} as never, pageId: page() };
  await assert.rejects(
    handleSdkCall(
      ctx,
      permissionsSchema.parse(undefined),
      { method: "ai", args: { prompt: "hi" } },
      host,
    ),
    /ai not allowed/,
  );
  assert.equal(keys.length, n);
  const ok = (await handleSdkCall(
    ctx,
    permissionsSchema.parse({ ai: true }),
    { method: "ai", args: { prompt: "hi" } },
    host,
  )) as { text: string };
  assert.equal(ok.text, "ok");
});

test("pageAi: no provider chosen -> ai.providerNotConfigured", async () => {
  const ctx = await owner();
  await sql`update workspaces set settings = '{}' where id = ${ctx.workspaceId}`;
  await assert.rejects(pageAi(ctx, page(), { prompt: "x" }), {
    code: "ai.providerNotConfigured",
  });
});
