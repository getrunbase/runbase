// useAI for pages: DeepSeek text completion for a component
// that declares the `ai` permission, with a strict cost guard:
// - workspace AI budget (min(preference, quota:aiBudgetUsd from entitlements)): exhausted = refused;
// - rate limited per workspace and per page;
// - tenant key only: no platform AI key.
// Provider and model: workspace AI settings, DeepSeek by
// default.
import { appError } from "./errors/app-error";
import {
  aiCost,
  complete,
  requireWorkspaceAi,
  type AiCompletion,
} from "./ai-providers";
import { rateLimitAi } from "./quotas";
import { chargeAi, readBudget } from "./runs";
import { decryptSecret } from "./secrets";
import { withTenant, type TenantContext } from "./tenant";

export const AI_MAX_TOKENS = 1024;

export type AiInput = { prompt: string; system?: string };

export async function pageAi(
  ctx: TenantContext,
  pageId: string,
  input: AiInput,
): Promise<AiCompletion> {
  await rateLimitAi(ctx, pageId);
  const budget = await withTenant(ctx, (tx) => readBudget(tx, ctx.workspaceId));
  if (budget.exhausted)
    throw appError(
      "ai.budgetExceeded",
      "AI budget exceeded for this workspace (USD {max} per month)",
      { max: (budget.budgetUsd ?? 0).toFixed(2) },
      { kind: "quota_exceeded" },
    );
  const { preset, model, keySecret } = await requireWorkspaceAi(ctx);
  const req = { ...input, maxTokens: AI_MAX_TOKENS };
  // Key provided by the user only: the platform does not
  // provide AI.
  const key = await decryptSecret(ctx, keySecret);
  if (!key)
    throw appError(
      "ai.providerKeyMissing",
      "{secret} not configured: add your {provider} key in Settings › General",
      { secret: keySecret, provider: preset.label },
    );
  const tokens = { input: 0, output: 0 };
  try {
    const out = await complete(preset, key, model, req);
    Object.assign(tokens, out.tokens);
    return out;
  } finally {
    const usd = aiCost(preset, model, tokens);
    // Same counter as runs: deducted from the budget (except own key;
    // outside DeepSeek, the key is necessarily the customer's).
    if (preset.id === "deepseek") await chargeAi(ctx, usd);
  }
}
