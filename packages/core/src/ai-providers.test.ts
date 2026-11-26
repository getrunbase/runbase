// AI providers: openai and anthropic adapters, mocked fetch.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  AI_PRESETS,
  complete,
  preset,
  resolveAi,
  resolveBlockAi,
} from "./ai-providers";

const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> & { messages?: unknown[] } }[] = [];
let reply: unknown;
let status = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({
    url: String(url),
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)),
  });
  return new Response(JSON.stringify(reply), { status });
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

test("no default provider", () => {
  assert.equal(resolveAi(undefined), null);
  assert.equal(resolveAi({}), null);
});

test("block AI config wins over the workspace fallback", () => {
  const fallback = resolveAi({ provider: "deepseek" });
  const own = resolveBlockAi(
    { provider: "anthropic", model: "claude-haiku-5-5", secret: "MY_KEY" },
    fallback,
  )!;
  assert.equal(own.preset.id, "anthropic");
  assert.equal(own.model, "claude-haiku-5-5");
  assert.equal(own.keySecret, "MY_KEY");
  // Unknown model: provider's first; no secret: preset's default secret.
  const lenient = resolveBlockAi({ provider: "openai", model: "nope" }, fallback)!;
  assert.equal(lenient.model, "gpt-6.1-sol");
  assert.equal(lenient.keySecret, "OPENAI_API_KEY");
});

test("block without AI config falls back (legacy workspace setting)", () => {
  const fallback = resolveAi({ provider: "deepseek" });
  assert.equal(resolveBlockAi(undefined, fallback), fallback);
  assert.equal(resolveBlockAi({ provider: "unknown" }, fallback), fallback);
  assert.equal(resolveBlockAi(undefined, null), null);
});

test("DeepSeek selected, openai format: text and usage mapped", async () => {
  const { preset: p, model } = resolveAi({ provider: "deepseek" })!;
  assert.equal(p.id, "deepseek");
  assert.equal(p.format, "openai");
  assert.equal(p.baseUrl, "https://api.deepseek.com");
  reply = {
    choices: [{ message: { content: "salut" } }],
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  };
  const out = await complete(p, "k", model, {
    prompt: "hi",
    system: "sys",
    maxTokens: 50,
  });
  assert.deepEqual(out, { text: "salut", tokens: { input: 12, output: 34 } });
  const c = calls.at(-1)!;
  assert.equal(c.url, "https://api.deepseek.com/chat/completions");
  assert.equal(c.headers.authorization, "Bearer k");
  assert.equal(c.body.model, model);
  assert.deepEqual(c.body.messages?.[0], { role: "system", content: "sys" });
});

test("anthropic format: text and usage mapped", async () => {
  reply = {
    content: [{ type: "text", text: "a" }, { type: "text", text: "b" }],
    usage: { input_tokens: 5, output_tokens: 7 },
  };
  const p = preset("anthropic");
  const out = await complete(p, "k2", "m", { prompt: "hi", maxTokens: 10 });
  assert.deepEqual(out, { text: "ab", tokens: { input: 5, output: 7 } });
  const c = calls.at(-1)!;
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.headers["x-api-key"], "k2");
  assert.equal(c.body.system, undefined);
});

test("HTTP error -> ai.providerError", async () => {
  status = 401;
  reply = {};
  await assert.rejects(
    complete(preset("openai"), "k", "m", { prompt: "hi", maxTokens: 1 }),
    (e: { code?: string }) => e.code === "ai.providerError",
  );
  status = 200;
});

test("settings: model not in list -> first model, unknown provider -> null", () => {
  assert.equal(resolveAi({ provider: "openai", model: "gpt-x" })!.model, "gpt-6.1-sol");
  assert.equal(resolveAi({ provider: "openai" })!.model, "gpt-6.1-sol");
  assert.equal(resolveAi({ provider: "nope" }), null);
  assert.ok(new Set(AI_PRESETS.map((p) => p.id)).size === AI_PRESETS.length);
});

// OpenAI (ChatGPT).
test("OpenAI: preset, response and usage mapped", async () => {
  const { preset: p, model } = resolveAi({ provider: "openai" })!;
  assert.equal(p.baseUrl, "https://api.openai.com/v1");
  assert.equal(model, "gpt-6.1-sol");
  reply = {
    choices: [{ message: { content: "hello" } }],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
  };
  const out = await complete(p, "sk-test", model, { prompt: "hi", maxTokens: 20 });
  assert.deepEqual(out, { text: "hello", tokens: { input: 3, output: 4 } });
  const c = calls.at(-1)!;
  assert.equal(c.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(c.headers.authorization, "Bearer sk-test");
  assert.equal(c.body.model, "gpt-6.1-sol");
});

// Claude (Anthropic).
test("Claude: preset, headers, system, response and usage mapped", async () => {
  const { preset: p, model } = resolveAi({ provider: "anthropic" })!;
  assert.equal(model, "claude-sonnet-5-5");
  reply = {
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 8, output_tokens: 2 },
  };
  const out = await complete(p, "ak", model, { prompt: "hi", system: "sys", maxTokens: 30 });
  assert.deepEqual(out, { text: "ok", tokens: { input: 8, output: 2 } });
  const c = calls.at(-1)!;
  assert.equal(c.headers["x-api-key"], "ak");
  assert.equal(c.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.body.system, "sys");
  assert.equal(c.body.max_tokens, 30);
});

test("Claude: 401 (invalid key) -> ai.providerError", async () => {
  status = 401;
  reply = { type: "error", error: { type: "authentication_error" } };
  await assert.rejects(
    complete(preset("anthropic"), "bad", "m", { prompt: "hi", maxTokens: 1 }),
    (e: { code?: string }) => e.code === "ai.providerError",
  );
  status = 200;
});

// Gemini through Google's OpenAI-compatible endpoint.
test("Gemini: text, token usage and 401 -> ai.providerError", async () => {
  const { preset: p, model } = resolveAi({ provider: "gemini" })!;
  assert.equal(p.format, "openai");
  assert.equal(model, "gemini-2.5-flash");
  reply = {
    choices: [{ message: { content: "hello" } }],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
  };
  const out = await complete(p, "gk", model, { prompt: "hi", maxTokens: 5 });
  assert.deepEqual(out, { text: "hello", tokens: { input: 3, output: 4 } });
  const c = calls.at(-1)!;
  assert.equal(c.url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(c.headers.authorization, "Bearer gk");
  status = 401;
  reply = { error: { code: 401 } };
  await assert.rejects(
    complete(p, "bad", model, { prompt: "hi", maxTokens: 1 }),
    (e: { code?: string }) => e.code === "ai.providerError",
  );
  status = 200;
});
