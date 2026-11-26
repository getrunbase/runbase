// useAI for pages: text completion with an AI config declared by a component
// (`permissions.ai`), with a strict cost guard:
// - workspace AI budget (min(preference, quota:aiBudgetUsd from entitlements)): exhausted = refused;
// - rate limited per workspace and per page;
// - tenant key only: no platform AI key.
// Provider, model and key secret: only the AI configs declared by the page
// (`permissions.ai`), no workspace default. The key is read server-side.
import { appError } from "./errors/app-error";
import {
  aiCost,
  complete,
  resolveAi,
  type AiCompletion,
  type AiConfig,
} from "./ai-providers";
import { rateLimitAi } from "./quotas";
import { chargeAi, readBudget } from "./runs";
import { decryptSecret } from "./secrets";
import { withTenant, type TenantContext } from "./tenant";

export const AI_MAX_TOKENS = 1024;

export type AiInput = { prompt: string; system?: string; name?: string };

// Config declared by the page under `name` (default: `default`), otherwise
// a clear error: the page never falls back to another AI.
export function pageAiConfig(configs: Record<string, AiConfig>, name?: string) {
  const key = name ?? "default";
  const ai = Object.hasOwn(configs, key) ? resolveAi(configs[key]) : null;
  if (ai) return ai;
  const declared = Object.keys(configs);
  throw appError(
    "ai.pageNotConfigured",
    "No AI config \"{name}\" declared by this page (declared: {declared}). Add it to permissions.ai.",
    { name: key, declared: declared.length ? declared.join(", ") : "none" },
  );
}

export async function pageAi(
  ctx: TenantContext,
  pageId: string,
  configs: Record<string, AiConfig>,
  { name, ...input }: AiInput,
): Promise<AiCompletion> {
  // Resolved first: an undeclared config costs nothing.
  const { preset, model, keySecret } = pageAiConfig(configs, name);
  await rateLimitAi(ctx, pageId);
  const budget = await withTenant(ctx, (tx) => readBudget(tx, ctx.workspaceId));
  if (budget.exhausted)
    throw appError(
      "ai.budgetExceeded",
      "AI budget exceeded for this workspace (USD {max} per month)",
      { max: (budget.budgetUsd ?? 0).toFixed(2) },
      { kind: "quota_exceeded" },
    );
  const req = { ...input, maxTokens: AI_MAX_TOKENS };
  // Key provided by the user only: the platform does not
  // provide AI.
  const key = await decryptSecret(ctx, keySecret);
  if (!key)
    throw appError(
      "ai.providerKeyMissing",
      "{secret} not configured: add your {provider} key in Settings › Secrets",
      { secret: keySecret, provider: preset.label },
    );
  const tokens = { input: 0, output: 0 };
  try {
    const out = await complete(preset, key, model, req);
    Object.assign(tokens, out.tokens);
    return out;
  } finally {
    const usd = aiCost(preset, model, tokens);
    // Same counter as runs, whatever the provider: every key is the
    // workspace's own, and the budget tracks its spending.
    await chargeAi(ctx, usd);
  }
}
