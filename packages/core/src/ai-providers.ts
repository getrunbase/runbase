// AI providers: presets + two API formats (openai
// chat/completions, anthropic messages), same output (text + token usage
// for cost caps). Adding a provider = one line.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireScope } from "./api-keys";
import { audit } from "./audit";
import { workspaces } from "./db/schema";
import { appError } from "./errors/app-error";
import { putSecret, secretNameSchema } from "./secrets";
import { withTenant, type TenantContext } from "./tenant";
import { resumeBudgetRuns } from "./runs/budget";

export type AiFormat = "openai" | "anthropic";
export type AiPreset = {
  id: string;
  label: string;
  format: AiFormat;
  baseUrl: string;
  // Workspace secret that holds the key (encrypted in the vault).
  keySecret: string;
  // Offered models (the first one is the fallback); prices in $ per million
  // tokens (input, output), for the AI budget.
  models: readonly AiModel[];
};
export type AiModel = { id: string; label: string; price: readonly [number, number] };

// Sources (2026-11-24): platform.claude.com/docs/en/about-claude/pricing,
// developers.openai.com/api/docs/pricing, api-docs.deepseek.com/quick_start/pricing,
// ai.google.dev/gemini-api/docs/pricing (Gemini Pro: >200K tokens price, conservative).
// Haiku: >100K tokens price used; DeepSeek: peak-hours price (conservative).
export const AI_PRESETS = [
  { id: "deepseek", label: "DeepSeek", format: "openai", baseUrl: "https://api.deepseek.com", keySecret: "DEEPSEEK_API_KEY", models: [
    { id: "deepseek-flash", label: "DeepSeek V4.1 Flash", price: [0.3, 1.2] },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", price: [1.32, 3.96] },
  ] },
  { id: "openai", label: "ChatGPT (OpenAI)", format: "openai", baseUrl: "https://api.openai.com/v1", keySecret: "OPENAI_API_KEY", models: [
    { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", price: [2, 10] },
    { id: "gpt-6-astra", label: "GPT-6 Astra", price: [10, 50] },
    { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", price: [1, 5] },
    { id: "gpt-6-luna", label: "GPT-6 Luna", price: [0.1, 0.5] },
  ] },
  { id: "anthropic", label: "Claude (Anthropic)", format: "anthropic", baseUrl: "https://api.anthropic.com/v1", keySecret: "ANTHROPIC_API_KEY", models: [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", price: [2, 10] },
    { id: "claude-fable-5-2", label: "Claude Fable 5.2", price: [8, 40] },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", price: [4, 20] },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", price: [0.5, 2.5] },
  ] },
  // Google's OpenAI-compatible endpoint (returns `usage` like OpenAI).
  { id: "gemini", label: "Gemini (Google)", format: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keySecret: "GEMINI_API_KEY", models: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", price: [0.3, 2.5] },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", price: [2.5, 15] },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", price: [0.1, 0.4] },
  ] },
] as const satisfies readonly AiPreset[];

// Model from the list, otherwise the provider's first one (lenient read).
export const aiModel = (p: AiPreset, id?: string): AiModel =>
  p.models.find((m) => m.id === id) ?? p.models[0]!;

export type AiProviderId = (typeof AI_PRESETS)[number]["id"];

// No default provider: the workspace chooses its AI.
export const preset = (id: AiProviderId): AiPreset =>
  AI_PRESETS.find((p) => p.id === id)!;

export const aiNotConfigured = () =>
  appError("ai.providerNotConfigured", "No AI provider configured. Choose one in settings.");

export type AiTokens = { input: number; output: number };
export type AiCompletion = { text: string; tokens: AiTokens };
export type AiRequest = {
  prompt: string;
  system?: string;
  maxTokens: number;
  signal?: AbortSignal;
};

export const aiCost = (p: AiPreset, model: string, u: AiTokens) => {
  const { price } = aiModel(p, model);
  return (u.input * price[0] + u.output * price[1]) / 1e6;
};

const providerError = (status: number) =>
  appError("ai.providerError", "AI provider error {status}", { status });

// Adapters: HTTP request + parsing of the response into the common format.
const adapters: Record<
  AiFormat,
  (p: AiPreset, key: string, model: string, r: AiRequest) => {
    url: string;
    headers: Record<string, string>;
    body: object;
    parse: (json: never) => AiCompletion;
  }
> = {
  openai: (p, key, model, r) => ({
    url: `${p.baseUrl}/chat/completions`,
    headers: { authorization: `Bearer ${key}` },
    body: {
      model,
      max_tokens: r.maxTokens,
      messages: [
        ...(r.system ? [{ role: "system", content: r.system }] : []),
        { role: "user", content: r.prompt },
      ],
    },
    parse: (json: {
      choices: { message: { content: string | null } }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    }) => ({
      text: json.choices[0]?.message.content ?? "",
      tokens: {
        input: json.usage.prompt_tokens,
        output: json.usage.completion_tokens,
      },
    }),
  }),
  anthropic: (p, key, model, r) => ({
    url: `${p.baseUrl}/messages`,
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: {
      model,
      max_tokens: r.maxTokens,
      ...(r.system && { system: r.system }),
      messages: [{ role: "user", content: r.prompt }],
    },
    parse: (json: {
      content: { type: string; text?: string }[];
      usage: { input_tokens: number; output_tokens: number };
    }) => ({
      text: json.content.map((c) => (c.type === "text" ? c.text : "")).join(""),
      tokens: {
        input: json.usage.input_tokens,
        output: json.usage.output_tokens,
      },
    }),
  }),
};

// Size of the request sent (to reserve the maximum cost before the call).
export function aiPayloadSize(p: AiPreset, model: string, r: AiRequest) {
  return JSON.stringify(adapters[p.format](p, "", model, r).body).length;
}

export async function complete(
  p: AiPreset,
  key: string,
  model: string,
  r: AiRequest,
): Promise<AiCompletion> {
  const a = adapters[p.format](p, key, model, r);
  const res = await fetch(a.url, {
    method: "POST",
    headers: { ...a.headers, "content-type": "application/json" },
    body: JSON.stringify(a.body),
    signal: r.signal ?? AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw providerError(res.status);
  return a.parse(JSON.parse(text) as never);
}

// Workspace AI settings (in `workspaces.settings.ai`); the key is an
// encrypted secret named by the preset (`keySecret`).
export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PRESETS.map((p) => p.id) as [AiProviderId, ...AiProviderId[]]),
  model: z.string().trim().max(200).optional(),
  // Vault secret chosen for the key; default: the preset's one.
  keySecret: secretNameSchema.optional(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

// null = no provider chosen (no fallback).
export function resolveAi(raw: unknown) {
  const s = aiSettingsSchema.safeParse(raw);
  if (!s.success) return null;
  const p = preset(s.data.provider);
  const model = aiModel(p, s.data.model).id;
  const keySecret = s.data.keySecret || p.keySecret;
  return { preset: p, model, keySecret };
}

// Per-block AI config (AI workflow blocks, `input.ai`): provider, model and
// the workspace secret holding the key. `secret` (not `keySecret`) so the
// secret usage scan picks it up like other block secret references.
export const blockAiSchema = z.object({
  provider: z.enum(AI_PRESETS.map((p) => p.id) as [AiProviderId, ...AiProviderId[]]),
  model: z.string().trim().max(200).optional(),
  secret: secretNameSchema.optional(),
});
export type BlockAi = z.infer<typeof blockAiSchema>;

// Block config first; otherwise the fallback (legacy workspace setting) so
// blocks saved before per-block config keep running. null = none.
export function resolveBlockAi(
  block: unknown,
  fallback: ReturnType<typeof resolveAi>,
): ReturnType<typeof resolveAi> {
  const s = blockAiSchema.safeParse(block);
  if (!s.success) return fallback;
  return resolveAi({
    provider: s.data.provider,
    model: s.data.model,
    keySecret: s.data.secret,
  });
}

async function readRaw(ctx: TenantContext) {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId)),
  );
  return (row?.settings ?? {}) as Record<string, unknown>;
}

export async function workspaceAi(ctx: TenantContext) {
  return resolveAi((await readRaw(ctx)).ai);
}

// Chosen provider, otherwise ai.providerNotConfigured.
export async function requireWorkspaceAi(ctx: TenantContext) {
  const ai = await workspaceAi(ctx);
  if (!ai) throw aiNotConfigured();
  return ai;
}

export const aiSettingsService = {
  presets: () => AI_PRESETS,
  get: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const ai = await workspaceAi(ctx);
    return {
      provider: ai?.preset.id ?? null,
      model: ai?.model ?? "",
      keySecret: ai?.keySecret ?? "",
    };
  },
  // Provider + model + referenced secret (by name); optional key
  // (empty = unchanged) stored under that name, never read back.
  set: async (
    ctx: TenantContext,
    input: { provider: string; model?: string; keySecret?: string; key?: string },
  ) => {
    await requireScope(ctx, "admin");
    const s = aiSettingsSchema.safeParse({
      ...input,
      keySecret: input.keySecret?.trim() || undefined,
    });
    if (!s.success)
      throw appError("ai.unknownProvider", "Unknown AI provider {provider}", {
        provider: String(input.provider),
      });
    const p = preset(s.data.provider);
    if (s.data.model && !p.models.some((m) => m.id === s.data.model))
      throw appError("ai.unknownModel", "Unknown AI model {model}", { model: s.data.model });
    const ai = {
      provider: p.id,
      ...(s.data.model && { model: s.data.model }),
      ...(s.data.keySecret &&
        s.data.keySecret !== p.keySecret && { keySecret: s.data.keySecret }),
    };
    const keySecret = s.data.keySecret ?? p.keySecret;
    const settings = await readRaw(ctx);
    await withTenant(ctx, async (tx) => {
      if (input.key?.trim()) await putSecret(tx, ctx, keySecret, input.key.trim());
      await tx
        .update(workspaces)
        .set({ settings: { ...settings, ai } })
        .where(eq(workspaces.id, ctx.workspaceId));
      await audit(tx, ctx, "workspace.ai_settings", { type: "workspace", id: ctx.workspaceId }, {
        ...ai,
        key: !!input.key?.trim(),
      });
    });
    // Provider key added (any provider): runs paused on budget resume.
    if (input.key?.trim()) await resumeBudgetRuns(ctx);
  },
};
