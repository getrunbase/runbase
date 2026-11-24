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
