// Sandbox service: remote execution through SANDBOX_URL, SDK relayed
// in the stream, empty env. Requires `deno` in the PATH (no DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { denoEnv, execFunction, execLocal, netFlags } from "./sandbox";
import { createSandboxServer } from "./sandbox-server";

const TOKEN = "test-token-0123456789abcdef";
const server = createSandboxServer(TOKEN);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const remote = async <T>(fn: () => Promise<T>) => {
  process.env.SANDBOX_URL = url;
  process.env.SANDBOX_TOKEN = TOKEN;
  try {
    return await fn();
  } finally {
    delete process.env.SANDBOX_URL;
    delete process.env.SANDBOX_TOKEN;
  }
};

test("empty env: no infra variable visible, --allow-env never granted", async () => {
  process.env.DATABASE_URL ??= "postgres://leak";
  const code = `export default () => {
    try { return { env: Deno.env.toObject() }; } catch (e) { return { denied: e.name }; }
  }`;
  const { output } = await execLocal({ code }, {});
  assert.deepEqual(output, { denied: "NotCapable" });
  // Even with the permission, the Deno process does not inherit process.env.
  const env = denoEnv();
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.REDIS_URL, undefined);
  assert.equal(env.SECRETS_MASTER_KEY, undefined);
  assert.equal(env.NO_COLOR, "1");
});

test("postgres and redis unreachable without a declared domain", async () => {
  for (const port of [5432, 6379]) {
    const code = `export default async () => { await Deno.connect({ hostname: "127.0.0.1", port: ${port} }); }`;
    await assert.rejects(execLocal({ code }, {}), /net access|NotCapable/);
  }
});

// domains ["*"] opens --allow-net to any host: postgres and redis stay
// refused, by the guard (real function) and by --deny-net alone (Deno
// started without guard, with the sandbox network flags).
test('domains ["*"]: postgres and redis refused, --deny-net alone is enough', async () => {
  const prev = process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
  delete process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
  const dir = await mkdtemp(join(tmpdir(), "deny-net-"));
  try {
    for (const hostname of ["127.0.0.1", "localhost"])
      for (const port of [5432, 6379]) {
        const body = `const c = await Deno.connect({ hostname: "${hostname}", port: ${port} }); c.close();`;
        await assert.rejects(
          execLocal(
            {
              code: `export default async () => { ${body} return "connected"; }`,
              permissions: { domains: ["*"], secrets: [] },
            },
            {},
          ),
          /blocked|net access|NotCapable/,
          `${hostname}:${port} via the function`,
        );
        const script = join(dir, `p${port}.ts`);
        await writeFile(script, body);
        const r = spawnSync(
          process.env.DENO_BIN || "deno",
          ["run", "--no-prompt", ...netFlags(["*"]), script],
          { env: denoEnv(), encoding: "utf8" },
        );
        assert.notEqual(r.status, 0, `${hostname}:${port} via --deny-net`);
        assert.match(r.stderr, /NotCapable|net access/);
      }
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (prev !== undefined) process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK = prev;
  }
});

test("remote execution: output, logs, declared secrets, relayed SDK", async () => {
  const calls: unknown[] = [];
  const r = await remote(() =>
    execFunction(
      {
        code: `export default async (i, ctx) => {
          console.log("hello");
          const rec = await ctx.records.get(i.id);
          await ctx.events.push({ type: "t" });
          return { rec, s: ctx.secrets };
        }`,
        permissions: { domains: [], secrets: ["A"], records: "read" },
      },
      { id: "r1" },
      {
        secrets: { A: "a", B: "b" },
        host: async (method, args) => {
          calls.push([method, args]);
          return method === "get" ? { id: args[0] } : { ok: true };
        },
      },
    ),
  );
  assert.deepEqual(r.output, { rec: { id: "r1" }, s: { A: "a" } });
  assert.match(r.logs, /hello/);
  assert.deepEqual(calls, [
    ["get", ["r1"]],
    ["events.push", [{ type: "t" }]],
  ]);
});

test("remote execution: function error and error code preserved", async () => {
  await assert.rejects(
    remote(() =>
      execFunction(
        { code: `export default () => { throw new Error("boom"); }` },
        {},
      ),
    ),
    /boom/,
  );
  await assert.rejects(
    remote(() =>
      execFunction(
        {
          code: "export default () => 1",
          permissions: { domains: ["*.com"], secrets: [] },
        },
        {},
      ),
    ),
    (e: Error & { code?: string }) => e.code === "functions.invalidDomain",
  );
});

test("token required", async () => {
  process.env.SANDBOX_URL = url;
  process.env.SANDBOX_TOKEN = "wrong-token-0123456789abcdef";
  try {
    await assert.rejects(
      execFunction({ code: "export default () => 1" }, {}),
      /sandbox HTTP 401/,
    );
  } finally {
    delete process.env.SANDBOX_URL;
    delete process.env.SANDBOX_TOKEN;
  }
});
