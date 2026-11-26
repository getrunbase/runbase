// AI blocks: provider, model and key secret set on the block (`input.ai`),
// required to run: no workspace default, no implicit provider. Messages use the Anthropic Messages shape internally;
// OpenAI-format presets are translated (tools = function calling). Key:
// workspace secret named by the provider settings, never a platform key.
// Tokens and cost (model price of the preset) go up into `run_steps`.
import { z } from "zod";
import { CostCapExceeded, defineBlock, type BlockContext } from "../block";
import { appError, notFound } from "../../errors/app-error";
import type { Filter } from "../../filter";
import {
  aiConfigSchema,
  aiCost,
  resolveAi,
  type ResolvedAi,
} from "../../ai-providers";

// Safety cap per block execution, not configurable.
const MAX_COST_USD = 0.5;
const MAX_TURNS = 10;
const MAX_TOKENS = 4096;

type Usage = { input: number; output: number };
type Content =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };
type Tool = { name: string; description: string; input_schema: object };
type Message = { role: "user" | "assistant"; content: unknown };
type Body = {
  system?: string;
  messages: Message[];
  tools?: Tool[];
  tool_choice?: { type: "tool"; name: string };
};
type Reply = { content: Content[]; usage: Usage };
type Ai = ResolvedAi;

// No AI config on the block: explicit failure naming it, no fallback.
function resolve(type: string, block: unknown): Ai {
  const ai = resolveAi(block);
  if (!ai)
    throw appError(
      "ai.blockNotConfigured",
      "{block}: no AI configured. Set `ai` (provider, model, secret) on this block.",
      { block: type },
    );
  return ai;
}

async function call(
  ctx: BlockContext,
  type: string,
  block: unknown,
  body: Body,
  usage: Usage,
) {
  const step = ctx.run?.stepId;
  const ai = resolve(step ? `${type} (${step})` : type, block);
  // User key only: never a platform key.
  const key = (await ctx.settings()).secrets[ai.keySecret];
  if (!key)
    throw appError(
      "ai.keyMissing",
      "{secret} not configured: add it in Settings › Secrets",
      { secret: ai.keySecret },
    );
  const reply =
    ai.preset.format === "anthropic"
      ? await anthropic(ctx, ai, key, body)
      : await openai(ctx, ai, key, body);
  usage.input += reply.usage.input;
  usage.output += reply.usage.output;
  const spent = aiCost(ai.preset, ai.model, usage);
  if (spent > MAX_COST_USD)
    throw new CostCapExceeded(`${spent} $ > ${MAX_COST_USD} $`, spent, usage);
  return { content: reply.content, cost: spent };
}

async function post(
  ctx: BlockContext,
  ai: Ai,
  url: string,
  headers: Record<string, string>,
  body: object,
) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: ctx.signal,
  });
  const text = await res.text();
  if (!res.ok)
    throw appError("ai.httpError", "{provider} {status}: {detail}", {
      provider: ai.preset.label,
      status: res.status,
      detail: text.slice(0, 300),
    });
  return JSON.parse(text) as unknown;
}

async function anthropic(
  ctx: BlockContext,
  ai: Ai,
  key: string,
  body: Body,
): Promise<Reply> {
  const json = (await post(
    ctx,
    ai,
    `${ai.preset.baseUrl}/messages`,
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    { model: ai.model, max_tokens: MAX_TOKENS, ...body },
  )) as {
    content: Content[];
    usage: { input_tokens: number; output_tokens: number };
  };
  return {
    content: json.content,
    usage: { input: json.usage.input_tokens, output: json.usage.output_tokens },
  };
}

// Anthropic-shaped conversation -> OpenAI chat/completions (function calling).
export function toOpenAi(model: string, body: Body) {
  const messages: object[] = body.system
    ? [{ role: "system", content: body.system }]
    : [];
  for (const m of body.messages) {
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    const parts = m.content as (
      | Content
      | { type: "tool_result"; tool_use_id: string; content: string }
    )[];
    if (m.role === "assistant") {
      const text = parts
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      const calls = parts.flatMap((c) =>
        c.type === "tool_use"
          ? [
              {
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              },
            ]
          : [],
      );
      messages.push({
        role: "assistant",
        content: text || null,
        ...(calls.length && { tool_calls: calls }),
      });
    } else
      for (const c of parts)
        if (c.type === "tool_result")
          messages.push({
            role: "tool",
            tool_call_id: c.tool_use_id,
            content: c.content,
          });
  }
  return {
    model,
    max_tokens: MAX_TOKENS,
    messages,
    ...(body.tools && {
      tools: body.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
    }),
    ...(body.tool_choice && {
      tool_choice: {
        type: "function",
        function: { name: body.tool_choice.name },
      },
    }),
  };
}

async function openai(
  ctx: BlockContext,
  ai: Ai,
  key: string,
  body: Body,
): Promise<Reply> {
  const json = (await post(
    ctx,
    ai,
    `${ai.preset.baseUrl}/chat/completions`,
    { authorization: `Bearer ${key}` },
    toOpenAi(ai.model, body),
  )) as {
    choices: {
      message: {
        content: string | null;
        tool_calls?: {
          id: string;
          function: { name: string; arguments: string };
        }[];
      };
    }[];
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  const msg = json.choices[0]?.message;
  const content: Content[] = [
    ...(msg?.content ? [{ type: "text" as const, text: msg.content }] : []),
    ...(msg?.tool_calls ?? []).map((t) => {
      let input: unknown;
      try {
        input = JSON.parse(t.function.arguments || "{}");
      } catch {
        input = undefined;
      }
      return { type: "tool_use" as const, id: t.id, name: t.function.name, input };
    }),
  ];
  return {
    content,
    usage: {
      input: json.usage.prompt_tokens,
      output: json.usage.completion_tokens,
    },
  };
}

// Injected context: record, timeline… as JSON.
const system = (input: { context?: unknown }) =>
  input.context === undefined
    ? undefined
    : `You are a step in an automated workflow. The data below is the subject of the instruction (the record being processed), not the user.\n\n# Data\n\n${JSON.stringify(input.context, null, 2)}`;

const base = {
  prompt: z.string().min(1),
  // Record, timeline… already rendered by the engine (`{{record}}`).
  context: z.unknown().optional(),
  // Provider, model and key secret of this block: required to run (checked
  // at execution so drafts stay savable).
  ai: aiConfigSchema
    .optional()
    .describe("AI of this block (required to run): { provider, model, secret }"),
};

const decision = z.object({
  branch: z.string(),
  reason: z.string(),
  confidence: z.number(),
});

// Picks one branch among the declared ones; output forced by a tool.
export const aiDecide = defineBlock({
  type: "ai.decide",
  label: "AI decision",
  description: "The AI picks one of the declared branches and explains why.",
  sideEffect: false,
  inputSchema: z.object({
    ...base,
    branches: z.array(z.string().min(1)).min(1),
  }),
  outputSchema: decision,
  // Dynamic branches: those declared in the step input.
  branches: [],
  run: async (input, ctx) => {
    const usage = { input: 0, output: 0 };
    const res = await call(
      ctx,
      "ai.decide",
      input.ai,
      {
        system: system(input),
        messages: [{ role: "user", content: input.prompt }],
        tools: [
          {
            name: "decide",
            description: "Returns the decision.",
            input_schema: {
              type: "object",
              properties: {
                branch: { type: "string", enum: input.branches },
                reason: { type: "string" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["branch", "reason", "confidence"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "decide" },
      },
      usage,
    );
    const use = res.content.find((c) => c.type === "tool_use");
    const out = decision.parse(use?.input);
    if (!input.branches.includes(out.branch))
      throw appError("ai.unknownBranch", "Branch not in the list: {branch}", {
        branch: String(out.branch),
      });
    return {
      branch: out.branch,
      output: out,
      tokens: usage,
      cost: res.cost,
    };
  },
});

// Agent: tools limited to declared objects (`objects`), free output
// (text) or matching `schema` (JSON Schema) through a forced final tool.
export const aiRun = defineBlock({
  type: "ai.run",
  label: "AI agent",
  description: "The AI follows an instruction and can read or update objects.",
  sideEffect: true,
  inputSchema: z.object({
    ...base,
    objects: z.array(z.string().min(1)).default([]),
    schema: z.record(z.string(), z.unknown()).optional(),
  }),
  outputSchema: z.object({ result: z.unknown() }),
  branches: ["ok"],
  run: async (input, ctx) => {
    const { services } = ctx;
    const usage = { input: 0, output: 0 };
    const ids = new Map<string, string>(); // objectId -> slug
    for (const slug of input.objects) {
      const obj = await services.objects.get(slug);
      if (!obj)
        throw notFound("blocks.unknownObject", "Unknown object: {object}", {
          object: slug,
        });
      ids.set(obj.id, slug);
    }
    const allowed = async (recordId: string) => {
      const r = await services.records.get(recordId);
      if (!ids.has(r.objectId))
        throw appError("ai.objectNotAllowed", "Object not allowed");
      return r;
    };
    const slugs = { type: "string", enum: input.objects };
    const tools: Tool[] = input.objects.length
      ? [
          {
            name: "search_records",
            description: "Searches records of an object (optional DSL filter).",
            input_schema: {
              type: "object",
              properties: {
                object: slugs,
                filter: {},
                limit: { type: "integer" },
              },
              required: ["object"],
            },
          },
          {
            name: "get_record",
            description: "Reads a record by id.",
            input_schema: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          },
          {
            name: "update_record",
            description: "Updates fields of a record (merge).",
            input_schema: {
              type: "object",
              properties: { id: { type: "string" }, data: { type: "object" } },
              required: ["id", "data"],
            },
          },
        ]
      : [];
    if (input.schema)
      tools.push({
        name: "output",
        description: "Returns the final result.",
        input_schema: input.schema,
      });
    const exec = async (name: string, a: Record<string, unknown>) => {
      if (name === "search_records") {
        const slug = String(a.object);
        if (!input.objects.includes(slug))
          throw appError("ai.objectNotAllowed", "Object not allowed");
        const id = [...ids].find(([, s]) => s === slug)![0];
        return services.records.search(id, {
          filter: a.filter as Filter | undefined,
          pagination: { limit: Math.min(Number(a.limit) || 20, 100) },
        });
      }
      if (name === "get_record") return allowed(String(a.id));
      if (name === "update_record") {
        await allowed(String(a.id));
        return services.records.update(
          String(a.id),
          a.data as Record<string, unknown>,
        );
      }
      throw appError("ai.unknownTool", "Unknown tool: {name}", { name });
    };

    const sys = system(input);
    const messages: Message[] = [{ role: "user", content: input.prompt }];
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await call(
        ctx,
        "ai.run",
        input.ai,
        {
          system: sys,
          messages,
          ...(tools.length && { tools }),
        },
        usage,
      );
      const done = (result: unknown) => ({
        branch: "ok",
        output: { result },
        tokens: usage,
        cost: res.cost,
      });
      const out = res.content.find(
        (c) => c.type === "tool_use" && c.name === "output",
      );
      if (out?.type === "tool_use") return done(out.input);
      const uses = res.content.filter((c) => c.type === "tool_use");
      if (!uses.length) {
        const text = res.content
          .map((c) => (c.type === "text" ? c.text : ""))
          .join("");
        if (input.schema) {
          messages.push(
            { role: "assistant", content: res.content },
            {
              role: "user",
              content: "Return the result with the output tool.",
            },
          );
          continue;
        }
        return done(text);
      }
      messages.push({ role: "assistant", content: res.content });
      const results = [];
      for (const u of uses) {
        if (u.type !== "tool_use") continue;
        try {
          const r = await exec(u.name, u.input as Record<string, unknown>);
          results.push({
            type: "tool_result",
            tool_use_id: u.id,
            content: JSON.stringify(r),
          });
        } catch (e) {
          results.push({
            type: "tool_result",
            tool_use_id: u.id,
            content: (e as Error).message,
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: results });
    }
    throw appError(
      "ai.noAnswer",
      "Agent gave no answer after {turns} turns",
      { turns: MAX_TURNS },
    );
  },
});

// Structured extraction: text -> JSON object matching a list of fields.
// Output forced by a tool, validated by zod; one retry if invalid.
const field = z.object({
  key: z.string().regex(/^[A-Za-z_][\w]*$/),
  type: z.enum(["string", "number", "boolean", "date", "enum", "array"]),
  description: z.string().optional(),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1)).optional(),
});
type Field = z.infer<typeof field>;

const jsonType = (f: Field): Record<string, unknown> => {
  const d = f.description ? { description: f.description } : {};
  if (f.type === "date")
    return {
      type: "string",
      format: "date",
      ...d,
      description: `${f.description ?? ""} (ISO 8601 date)`.trim(),
    };
  if (f.type === "enum") return { type: "string", enum: f.options, ...d };
  if (f.type === "array") return { type: "array", ...d };
  return { type: f.type, ...d };
};

const zodType = (f: Field): z.ZodType => {
  if (f.type === "date")
    return z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date");
  if (f.type === "enum") return z.enum(f.options as [string, ...string[]]);
  if (f.type === "array") return z.array(z.unknown());
  if (f.type === "number") return z.number();
  if (f.type === "boolean") return z.boolean();
  return z.string();
};

export const aiExtract = defineBlock({
  type: "ai.extract",
  label: "AI extraction",
  description: "The AI extracts structured fields from a text.",
  sideEffect: false,
  inputSchema: z
    .object({
      text: z.string().min(1),
      fields: z.array(field).min(1),
      instructions: z.string().optional(),
      ai: aiConfigSchema
        .optional()
        .describe("AI of this block (required to run): { provider, model, secret }"),
    })
    .superRefine((v, c) => {
      v.fields.forEach((f, i) => {
        if (f.type === "enum" && !f.options?.length)
          c.addIssue({
            code: "custom",
            path: ["fields", i, "options"],
            message: "options required for enum",
          });
      });
    }),
  outputSchema: z.record(z.string(), z.unknown()),
  branches: ["ok"],
  run: async (input, ctx) => {
    const usage = { input: 0, output: 0 };
    const schema = z.object(
      Object.fromEntries(
        input.fields.map((f) => [
          f.key,
          f.required ? zodType(f) : zodType(f).nullish(),
        ]),
      ),
    );
    const tool: Tool = {
      name: "extract",
      description: "Returns the extracted fields.",
      input_schema: {
        type: "object",
        properties: Object.fromEntries(
          input.fields.map((f) => [f.key, jsonType(f)]),
        ),
        required: input.fields.filter((f) => f.required).map((f) => f.key),
      },
    };
    const sys = `You extract structured data from the text given by the user. Use null for optional fields absent from the text; never invent values.${input.instructions ? `\n\n# Instructions\n\n${input.instructions}` : ""}`;
    const messages: Message[] = [{ role: "user", content: input.text }];
    let error = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await call(
        ctx,
        "ai.extract",
        input.ai,
        {
          system: sys,
          messages,
          tools: [tool],
          tool_choice: { type: "tool", name: "extract" },
        },
        usage,
      );
      const use = res.content.find((c) => c.type === "tool_use");
      const parsed = schema.safeParse(
        use?.type === "tool_use" ? use.input : undefined,
      );
      if (parsed.success)
        return {
          branch: "ok",
          output: parsed.data,
          tokens: usage,
          cost: res.cost,
        };
      error = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      messages.push(
        { role: "assistant", content: res.content },
        use?.type === "tool_use"
          ? {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: use.id,
                  is_error: true,
                  content: `Invalid output: ${error}. Call extract again with valid values.`,
                },
              ],
            }
          : {
              role: "user",
              content: "Return the result with the extract tool.",
            },
      );
    }
    throw appError(
      "blocks.extractInvalid",
      "AI extraction returned an invalid result: {error}",
      { error },
    );
  },
});
