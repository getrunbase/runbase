// AI blocks: mocked provider APIs (fetch): Anthropic (messages) by default,
// DeepSeek (OpenAI chat/completions format) for the translation. The lead qualification case
// (signup -> ai.decide -> branch) runs on the real engine: DATABASE_URL and
// REDIS_URL required.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Worker } from "bullmq";
import { blocks, CostCapExceeded, type BlockContext } from "../index";
import { settingsSchema } from "../../workspaces";
import { queueOptions } from "../../bus";
import { objectsService } from "../../objects";
import { recordsService } from "../../records";
import { workflowsService } from "../../workflows";
import { processStep, runsQueue, runsService, RUNS_QUEUE } from "../../runs";
import { secretsService } from "../../secrets";

type Body = {
  model: string;
  messages: { content: unknown }[];
  system?: string;
  tools?: { name: string }[];
};
const calls: Body[] = [];
// Raw OpenAI-format requests (DeepSeek).
const oaCalls: { model: string; messages: Record<string, unknown>[]; tools?: unknown[]; tool_choice?: unknown }[] = [];
let replies: ((b: Body) => unknown)[] = [];
let usage = { input_tokens: 1000, output_tokens: 100 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  const u = String(url);
  if (u === "https://api.anthropic.com/v1/messages") {
    const body = JSON.parse(String(init.body)) as Body;
    calls.push(body);
    const content = replies.shift()!(body);
    return new Response(
      JSON.stringify({ content, stop_reason: "end_turn", usage }),
    );
  }
  if (u === "https://api.deepseek.com/chat/completions") {
    const body = JSON.parse(String(init.body));
    oaCalls.push(body);
    const content = replies.shift()!(body) as {
      type: string;
      id: string;
      name: string;
      input: unknown;
    }[];
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: content.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            },
          },
        ],
        usage: {
          prompt_tokens: usage.input_tokens,
          completion_tokens: usage.output_tokens,
        },
      }),
    );
  }
  return realFetch(url, init);
}) as typeof fetch;
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => {
  globalThis.fetch = realFetch;
  setImmediate(() => process.exit(0));
});

const decide = (branch: string) => () => [
  {
    type: "tool_use",
    id: "t",
    name: "decide",
    input: { branch, reason: "r", confidence: 0.9 },
  },
];
// Default block AI for the tests: Anthropic (Sonnet: $2 / $10 per million
// tokens), added to the input unless the test sets `ai` (null = none).
const AI = new WeakMap<BlockContext, unknown>();
const ctx = (
  services: object = {},
  ai: unknown = { provider: "anthropic" },
): BlockContext => {
  const c: BlockContext = {
    services: services as BlockContext["services"],
    depth: 0,
    signal: new AbortController().signal,
    settings: async () =>
      settingsSchema.parse({
        secrets: { ANTHROPIC_API_KEY: "cle-tenant", DEEPSEEK_API_KEY: "cle-ds" },
      }),
  };
  AI.set(c, ai);
  return c;
};
const run = (type: string, input: unknown, c = ctx()) => {
  const ai = AI.has(c) ? AI.get(c) : { provider: "anthropic" };
  const i = { ...(ai ? { ai } : {}), ...(input as object) };
  return blocks[type]!.run(blocks[type]!.inputSchema.parse(i), c);
};

test("ai.decide: block AI config (provider, model, secret)", async () => {
  replies = [decide("yes")];
  calls.length = 0;
  const ok = await run(
    "ai.decide",
    {
      prompt: "?",
      branches: ["yes"],
      ai: { provider: "anthropic", model: "claude-haiku-5-5" },
    },
    ctx({}, null),
  );
  assert.equal(ok.branch, "yes");
  assert.equal(calls[0]!.model, "claude-haiku-5-5");
  // Block secret missing from the vault: explicit error naming it.
  replies = [decide("yes")];
  await assert.rejects(
    run("ai.decide", {
      prompt: "?",
      branches: ["yes"],
      ai: { provider: "anthropic", secret: "OTHER_KEY" },
    }),
    /OTHER_KEY not configured/,
  );
});

test("ai.decide: branch outside the list -> error", async () => {
  replies = [decide("maybe")];
  await assert.rejects(
    run("ai.decide", { prompt: "?", branches: ["yes", "non"] }),
    /Branch not in the list/,
  );
});

test("ai.decide: block provider and model, preset price, fixed cap", async () => {
  replies = [decide("yes")];
  calls.length = 0;
  const ok = await run("ai.decide", { prompt: "?", branches: ["yes"] });
  assert.equal(ok.branch, "yes");
  assert.equal(calls[0]!.model, "claude-sonnet-5-5");
  assert.equal(ok.cost, (1000 * 2 + 100 * 10) / 1e6);
  // Chosen model priced from its preset entry.
  replies = [decide("yes")];
  calls.length = 0;
  const haiku = await run(
    "ai.decide",
    { prompt: "?", branches: ["yes"] },
    ctx({}, { provider: "anthropic", model: "claude-haiku-5-5" }),
  );
  assert.equal(calls[0]!.model, "claude-haiku-5-5");
  assert.equal(haiku.cost, (1000 * 0.5 + 100 * 2.5) / 1e6);
  // 300 K input tokens = $0.6 > $0.5 cap.
  usage = { input_tokens: 300_000, output_tokens: 0 };
  replies = [decide("yes")];
  await assert.rejects(
    run("ai.decide", { prompt: "?", branches: ["yes"] }),
    (e: unknown) =>
      e instanceof CostCapExceeded && /^cost_cap_exceeded/.test(e.message),
  );
  usage = { input_tokens: 1000, output_tokens: 100 };
});

test("ai.run: tools limited to declared objects, output following a schema", async () => {
  const services = {
    objects: { get: async (s: string) => (s === "lead" ? { id: "o1" } : null) },
    records: {
      get: async (id: string) => ({
        id,
        objectId: id === "r1" ? "o1" : "o2",
        data: {},
      }),
      search: async () => [],
      update: async () => ({}),
    },
  };
  replies = [
    () => [
      { type: "tool_use", id: "a", name: "get_record", input: { id: "r2" } },
    ],
    () => [{ type: "tool_use", id: "b", name: "output", input: { score: 7 } }],
  ];
  calls.length = 0;
  const r = await run(
    "ai.run",
    {
      prompt: "score",
      objects: ["lead"],
      schema: { type: "object", properties: { score: { type: "number" } } },
    },
    ctx(services),
  );
  assert.deepEqual(r.output, { result: { score: 7 } });
  assert.deepEqual(r.tokens, { input: 2000, output: 200 });
  assert.equal(r.cost, (2000 * 2 + 200 * 10) / 1e6);
  // Record of an undeclared object: refused to the agent.
  const res = (
    calls[1]!.messages[2]!.content as { content: string; is_error: boolean }[]
  )[0]!;
  assert.equal(res.is_error, true);
  assert.match(res.content, /not allowed/);
});

test("lead qualification: signup -> ai.decide qualified / not qualified -> right branch", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const [org] =
    await sql`insert into organizations (name) values ('Acme') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name, settings) values (${org!.id}, 'Default', '{}') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'M', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const tctx = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  // Customer key: the platform never provides AI.
  await secretsService.set(tctx, "ANTHROPIC_API_KEY", "cle-client");

  const obj = await objectsService.create(tctx, {
    slug: "signup",
    name: "Signup",
    fields: [
      { key: "email", label: "Email", type: "text" },
      { key: "company", label: "Company", type: "text" },
    ],
  });
  const wf = await workflowsService.create(tctx, {
    name: "Qualif signup",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "qualify",
          type: "ai.decide",
          input: {
            prompt: "Is this signup qualified?",
            context: "{{record.data}}",
            branches: ["qualified", "not qualified"],
            ai: { provider: "anthropic", secret: "ANTHROPIC_API_KEY" },
          },
        },
        {
          id: "sales",
          type: "record.update",
          input: { recordId: "{{record.id}}", data: { company: "→ sales" } },
        },
        {
          id: "nurture",
          type: "record.update",
          input: { recordId: "{{record.id}}", data: { company: "→ nurture" } },
        },
      ],
      next: { qualify: { qualified: ["sales"], "not qualified": ["nurture"] } },
    },
  });
  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
  });
  // The mocked model qualifies based on the domain visible in the context.
  const model = (b: Body) =>
    decide(b.system?.includes("gmail.com") ? "not qualified" : "qualified")();

  for (const [email, branch, next] of [
    ["ceo@acme.io", "qualified", "sales"],
    ["bob@gmail.com", "not qualified", "nurture"],
  ] as const) {
    const { record } = await recordsService.upsert(tctx, {
      objectId: obj.id,
      data: { email, company: "x" },
    });
    replies = [model];
    const started = await runsService.start(tctx, wf.id, {
      recordId: record.id,
    });
    let r;
    for (let i = 0; i < 100; i++) {
      r = await runsService.get(tctx, started!.id);
      if (r!.status !== "running") break;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    assert.equal(r!.status, "succeeded");
    assert.deepEqual(
      r!.steps.map((s) => [s.stepId, s.branch]),
      [
        ["qualify", branch],
        [next, "ok"],
      ],
    );
    assert.deepEqual(r!.steps[0]!.tokens, { input: 1000, output: 100 });
    assert.equal(r!.steps[0]!.cost, (1000 * 2 + 100 * 10) / 1e6);
  }

  await worker.close();
});

const extract = (input: unknown) => () => [
  { type: "tool_use", id: "x", name: "extract", input },
];
const fields = [
  { key: "name", type: "string", required: true },
  { key: "amount", type: "number" },
  { key: "due", type: "date", required: true },
  { key: "status", type: "enum", options: ["paid", "open"], required: true },
  { key: "tags", type: "array" },
];

test("ai.extract: forced tool, validated output", async () => {
  replies = [
    extract({ name: "ACME", amount: 12, due: "2026-01-31", status: "open" }),
  ];
  calls.length = 0;
  const r = await run("ai.extract", {
    text: "Facture ACME",
    fields,
    instructions: "Montant TTC",
  });
  assert.equal(r.branch, "ok");
  assert.deepEqual(r.output, {
    name: "ACME",
    amount: 12,
    due: "2026-01-31",
    status: "open",
  });
  const tool = calls[0]!.tools![0] as unknown as {
    input_schema: { required: string[]; properties: Record<string, object> };
  };
  assert.deepEqual(tool.input_schema.required, ["name", "due", "status"]);
  assert.deepEqual(tool.input_schema.properties.status, {
    type: "string",
    enum: ["paid", "open"],
  });
  assert.match(calls[0]!.system!, /Montant TTC/);
  assert.ok(r.cost! > 0);
});

test("ai.extract: invalid output -> one retry then success", async () => {
  replies = [
    extract({ name: "ACME", due: "not a date", status: "open" }),
    extract({ name: "ACME", due: "2026-01-31", status: "paid" }),
  ];
  calls.length = 0;
  const r = await run("ai.extract", { text: "t", fields });
  assert.equal((r.output as { status: string }).status, "paid");
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1]!.messages.at(-1)), /due: invalid date/);
});

test("ai.extract: two invalid outputs -> appError", async () => {
  replies = [extract({ name: 1 }), extract({ status: "x" })];
  calls.length = 0;
  await assert.rejects(
    run("ai.extract", { text: "t", fields }),
    (e: unknown) =>
      (e as { code?: string }).code === "blocks.extractInvalid" &&
      calls.length === 2,
  );
});

test("ai.extract: enum without options refused", () => {
  assert.throws(() =>
    blocks["ai.extract"]!.inputSchema.parse({
      text: "t",
      fields: [{ key: "s", type: "enum" }],
    }),
  );
});

// Without a tenant key, no platform key: clear failure, no call.
test("ai without tenant key: ai.keyMissing, no provider call", async () => {
  const c: BlockContext = { ...ctx(), settings: async () => settingsSchema.parse({}) };
  calls.length = 0;
  await assert.rejects(
    run("ai.decide", { prompt: "?", branches: ["yes"] }, c),
    { code: "ai.keyMissing", params: { secret: "ANTHROPIC_API_KEY" } },
  );
  assert.equal(calls.length, 0);
});

// No AI on the block: error naming it, no implicit provider or default.
test("ai block without config: ai.blockNotConfigured, no call", async () => {
  calls.length = 0;
  oaCalls.length = 0;
  await assert.rejects(
    run("ai.decide", { prompt: "?", branches: ["yes"] }, ctx({}, null)),
    { code: "ai.blockNotConfigured", params: { block: "ai.decide" } },
  );
  const c = { ...ctx({}, null), run: { runId: "r", path: "0", n: 0, stepId: "qualify" } };
  AI.set(c, null);
  await assert.rejects(
    run("ai.extract", { text: "t", fields }, c),
    { code: "ai.blockNotConfigured", params: { block: "ai.extract (qualify)" } },
  );
  assert.equal(calls.length + oaCalls.length, 0);
});

// OpenAI-format preset: tools as function calling, tool results as `tool`.
test("ai.run on an OpenAI-format provider (DeepSeek): translated tools", async () => {
  const services = {
    objects: { get: async () => ({ id: "o1" }) },
    records: {
      get: async (id: string) => ({ id, objectId: "o1", data: { n: 1 } }),
      search: async () => [],
      update: async () => ({}),
    },
  };
  replies = [
    () => [{ type: "tool_use", id: "a", name: "get_record", input: { id: "r1" } }],
    () => [{ type: "tool_use", id: "b", name: "output", input: { ok: true } }],
  ];
  oaCalls.length = 0;
  const r = await run(
    "ai.run",
    { prompt: "go", objects: ["lead"], schema: { type: "object" } },
    ctx(services, { provider: "deepseek" }),
  );
  assert.deepEqual(r.output, { result: { ok: true } });
  assert.equal(oaCalls[0]!.model, "deepseek-flash");
  assert.equal(
    (oaCalls[0]!.tools![0] as { function: { name: string } }).function.name,
    "search_records",
  );
  const second = oaCalls[1]!.messages;
  assert.equal(second[0]!.role, "user");
  assert.equal(
    (second[1]!.tool_calls as { function: { name: string } }[])[0]!.function.name,
    "get_record",
  );
  assert.equal(second[2]!.role, "tool");
  assert.equal(second[2]!.tool_call_id, "a");
  // DeepSeek Flash price: $0.3 / $1.2 per million tokens.
  assert.equal(r.cost, (2000 * 0.3 + 200 * 1.2) / 1e6);
});
