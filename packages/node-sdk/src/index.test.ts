import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineNode, nodesOf } from "./index";
import { connectorRuntime } from "./runtime";

const double = defineNode({
  id: "math.double",
  inputs: z.object({ n: z.number() }),
  outputs: z.object({ n: z.number() }),
  run: async ({ n }) => ({ n: n * 2 }),
});

test("defineNode: id <connector>.<action> required", () => {
  for (const id of ["double", "Math.double", "math.", "math double"])
    assert.throws(
      () =>
        defineNode({
          id,
          inputs: z.object({}),
          outputs: z.object({}),
          run: async () => ({}),
        }),
      /invalid id/,
    );
});

test("execute: input validated before run, output validated after", async () => {
  assert.deepEqual(await double.execute({ n: 21 }), {
    branch: "ok",
    output: { n: 42 },
  });
  await assert.rejects(double.execute({ n: "x" }), /invalid input/);
  const bad = defineNode({
    id: "math.bad",
    inputs: z.object({}),
    outputs: z.object({ n: z.number() }),
    run: async () => ({ n: "x" }) as never,
  });
  await assert.rejects(bad.execute({}), /invalid output/);
});

test("execute: zod defaults applied, unknown keys removed", async () => {
  let seen: unknown;
  const n = defineNode({
    id: "x.defaults",
    inputs: z.object({ max: z.number().default(5) }),
    outputs: z.object({}),
    run: async (i) => ((seen = i), {}),
  });
  await n.execute({ secrets: { A: "a" } });
  assert.deepEqual(seen, { max: 5 });
});

test("branches: { branch, output } routed, unknown branch refused", async () => {
  const n = defineNode({
    id: "x.route",
    branches: ["yes", "no"],
    inputs: z.object({ v: z.boolean() }),
    outputs: z.object({ v: z.boolean() }),
    run: async ({ v }) =>
      v ? { branch: "yes", output: { v } } : { branch: "maybe", output: { v } },
  });
  assert.equal((await n.execute({ v: true })).branch, "yes");
  await assert.rejects(n.execute({ v: false }), /unknown branch "maybe"/);
});

test("context: secrets forwarded, network off by default", async () => {
  const n = defineNode({
    id: "x.ctx",
    inputs: z.object({}),
    outputs: z.object({ s: z.string(), net: z.string() }),
    run: async (_i, ctx) => ({
      s: ctx.secrets.K ?? "",
      net: await ctx.fetch("https://x.io").then(
        () => "on",
        (e: Error) => e.message,
      ),
    }),
  });
  const { output } = await n.execute({}, { secrets: { K: "v" } });
  assert.equal(output.s, "v");
  assert.match(output.net, /network disabled/);
});

test("manifest: JSON schemas, auth, side effect inferred from domains", () => {
  const n = defineNode({
    id: "api.call",
    label: "Call",
    auth: { secrets: ["KEY"], domains: ["api.x.io"] },
    inputs: z.object({ q: z.string().default("") }),
    outputs: z.object({ ok: z.boolean() }),
    run: async () => ({ ok: true }),
  });
  const m = n.manifest();
  assert.equal(m.sideEffect, true);
  assert.deepEqual(m.branches, ["ok"]);
  assert.deepEqual(m.auth, { secrets: ["KEY"], domains: ["api.x.io"] });
  assert.equal((m.inputSchema as { type: string }).type, "object");
  // Input schema: a field with a default stays optional.
  assert.deepEqual(
    (m.inputSchema as { required?: string[] }).required,
    undefined,
  );
  assert.equal(double.manifest().sideEffect, false);
});

test("nodesOf: default export, list or named exports; duplicates refused", () => {
  assert.equal(nodesOf({ default: double })[0], double);
  assert.equal(nodesOf({ default: [double] }).length, 1);
  assert.equal(nodesOf({ a: double, b: 1 }).length, 1);
  assert.throws(() => nodesOf({ default: {} }), /exports no node/);
  assert.throws(() => nodesOf({ default: [double, double] }), /duplicate/);
});

test("runtime: manifest then execution of a node", async () => {
  const rt = connectorRuntime({ default: [double] });
  const m = (await rt({ __runbase: "manifest" })) as { id: string }[];
  assert.deepEqual(
    m.map((x) => x.id),
    ["math.double"],
  );
  assert.deepEqual(
    await rt({ __runbase: "run", node: "math.double", input: { n: 2 } }),
    { branch: "ok", output: { n: 4 } },
  );
  await assert.rejects(
    rt({ __runbase: "run", node: "math.none", input: {} }),
    /unknown node/,
  );
});

test("OAuth node: connection input added, bearer only for its domains", async () => {
  const seen: Record<string, string | null> = {};
  const node = defineNode({
    id: "acme.me",
    auth: {
      domains: ["api.acme.com"],
      oauth: {
        provider: "acme",
        authorizeUrl: "https://acme.com/authorize",
        tokenUrl: "https://acme.com/token",
        scopes: ["read"],
      },
    },
    inputs: z.object({}),
    outputs: z.object({ ok: z.boolean() }),
    run: async (_, ctx) => {
      for (const u of ["https://api.acme.com/me", "https://evil.com/x"])
        await ctx.fetch(u);
      return { ok: Object.keys(ctx.secrets).length === 0 };
    },
  });
  const m = node.manifest();
  assert.equal(m.auth.oauth?.provider, "acme");
  assert.ok("connection" in (m.inputSchema.properties as object));
  const real = globalThis.fetch;
  globalThis.fetch = (async (req: Request) => {
    seen[new URL(req.url).hostname] = req.headers.get("authorization");
    return new Response("{}");
  }) as typeof fetch;
  try {
    const run = connectorRuntime([node]);
    const res = await run(
      { __runbase: "run", node: "acme.me", input: { connection: "work" } },
      { secrets: { __RUNBASE_OAUTH_TOKEN: "tok" } },
    );
    assert.deepEqual(res, { branch: "ok", output: { ok: true } });
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(seen["api.acme.com"], "Bearer tok");
  assert.equal(seen["evil.com"], null);
});

test("options: declared in the manifest, run with the OAuth token through ctx.fetch", async () => {
  assert.throws(
    () =>
      defineNode({
        id: "acme.bad",
        inputs: z.object({ a: z.string() }),
        outputs: z.object({}),
        options: { nope: async () => [] },
        run: async () => ({}),
      }),
    /options.nope is not an input/,
  );
  let seenAuth: string | null = null;
  let seenInput: unknown;
  const node = defineNode({
    id: "acme.tabs",
    auth: {
      domains: ["api.acme.com"],
      oauth: {
        provider: "acme",
        authorizeUrl: "https://acme.com/authorize",
        tokenUrl: "https://acme.com/token",
        scopes: ["read"],
      },
    },
    inputs: z.object({ sheet: z.string(), tab: z.string() }),
    outputs: z.object({}),
    options: {
      tab: async (input, ctx) => {
        seenInput = input;
        // The loader never sees the token.
        assert.equal(Object.keys(ctx.secrets).length, 0);
        const r = await ctx.fetch(`https://api.acme.com/${input.sheet}`);
        return ((await r.json()) as string[]).map((t) => ({
          value: t,
          label: t.toUpperCase(),
        }));
      },
    },
    run: async () => ({}),
  });
  assert.deepEqual(node.manifest().options, ["tab"]);
  assert.equal(double.manifest().options, undefined);
  const real = globalThis.fetch;
  globalThis.fetch = (async (req: Request) => {
    seenAuth = req.headers.get("authorization");
    return new Response(JSON.stringify(["a", "b"]));
  }) as typeof fetch;
  try {
    const run = connectorRuntime([node]);
    const res = await run(
      {
        __runbase: "options",
        node: "acme.tabs",
        field: "tab",
        input: { sheet: "s1" },
      },
      { secrets: { __RUNBASE_OAUTH_TOKEN: "tok" } },
    );
    assert.deepEqual(res, [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);
    await assert.rejects(
      run(
        { __runbase: "options", node: "acme.tabs", field: "sheet", input: {} },
        {},
      ),
      /no options for "sheet"/,
    );
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(seenAuth, "Bearer tok");
  assert.deepEqual(seenInput, { sheet: "s1" });
  const bad = defineNode({
    id: "acme.badopts",
    inputs: z.object({ a: z.string() }),
    outputs: z.object({}),
    options: { a: async () => [{ value: 1 }] as never },
    run: async () => ({}),
  });
  await assert.rejects(bad.loadOptions("a", {}), /invalid options/);
});
