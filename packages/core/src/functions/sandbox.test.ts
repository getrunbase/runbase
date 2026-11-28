// Sandbox runtime tests: require `deno` in the PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFunction } from "./sandbox";

const run = (code: string, input: unknown = {}, extra = {}) =>
  runFunction({ code, ...extra }, input);

test("runs the function, JSON I/O, declared secrets only", async () => {
  const out = await runFunction(
    {
      code: `export default (i) => { console.log("bruit"); return { n: i.n * 2, s: i.secrets }; }`,
      inputSchema: {
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
      },
      outputSchema: {
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
      },
      permissions: { domains: [], secrets: ["A"] },
    },
    { n: 21 },
    { secrets: { A: "a", B: "b" } },
  );
  assert.deepEqual(out, { n: 42, s: { A: "a" } });
});

test("input and output validated against the schemas", async () => {
  const schema = {
    type: "object",
    properties: { n: { type: "number" } },
    required: ["n"],
  };
  await assert.rejects(
    run(`export default () => ({ n: 1 })`, { n: "x" }, { inputSchema: schema }),
  );
  await assert.rejects(
    run(`export default () => ({ n: "x" })`, {}, { outputSchema: schema }),
  );
});

test("cannot read the disk", async () => {
  await assert.rejects(
    run(`export default () => Deno.readTextFileSync("/etc/hosts")`),
    /NotCapable|read access/,
  );
});

test("cannot write to disk or spawn processes", async () => {
  await assert.rejects(
    run(`export default () => Deno.writeTextFileSync("/tmp/x", "x")`),
    /write access/,
  );
  await assert.rejects(
    run(`export default () => new Deno.Command("ls").outputSync()`),
    /run access/,
  );
});

test("cannot read the environment", async () => {
  await assert.rejects(
    run(`export default () => Deno.env.get("HOME")`),
    /env access/,
  );
});

test("cannot reach an undeclared domain", async () => {
  await assert.rejects(
    run(
      `export default () => fetch("https://example.com")`,
      {},
      {
        permissions: { domains: ["api.declare.invalid"], secrets: [] },
      },
    ),
    /net access to "example.com/,
  );
});

test("process killed beyond the timeout", async () => {
  const t = Date.now();
  await assert.rejects(
    runFunction(
      { code: `export default () => { while (true) {} }` },
      {},
      { timeoutMs: 1500 },
    ),
    /timeout/,
  );
  assert.ok(Date.now() - t < 5000);
});

test("process killed on step abort", async () => {
  const t = Date.now();
  await assert.rejects(
    runFunction(
      { code: `export default () => { while (true) {} }` },
      {},
      { timeoutMs: 60_000, signal: AbortSignal.timeout(1000) },
    ),
    /abort/i,
  );
  assert.ok(Date.now() - t < 5000, `killed after ${Date.now() - t} ms`);
});

test("memory limit", async () => {
  await assert.rejects(
    runFunction(
      {
        code: `export default () => { const a = []; while (true) a.push(new Array(1e6).fill(1)); }`,
      },
      {},
      { memoryMb: 32 },
    ),
  );
});

// Local server counting requests: npm/JSR registries redirected to it,
// and domain allowed in --allow-net to check it is not used for imports.
test("https, npm:, jsr: and dynamic imports refused without a network request", async () => {
  let hits = 0;
  const srv = createServer((_req, res) => {
    hits++;
    res.end("export default () => 1;");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  process.env.NPM_CONFIG_REGISTRY = `${base}/npm/`;
  process.env.JSR_URL = `${base}/jsr/`;
  const perms = {
    permissions: { domains: [`127.0.0.1:${port}`], secrets: [] },
  };
  try {
    for (const code of [
      `import f from "${base}/x.ts"; export default f;`,
      `import "https://deno.land/std/path/mod.ts"; export default () => 1;`,
      `import pad from "npm:left-pad"; export default () => pad("a", 2);`,
      `import "jsr:@std/path"; export default () => 1;`,
      `export default () => import("${base}/y.ts");`,
      `export default () => import("npm:left-pad");`,
      `export default () => import(["${base}", "z.ts"].join("/"));`,
    ])
      await assert.rejects(run(code, {}, perms), /remote|npm|import/);
  } finally {
    process.env = env;
    srv.close();
  }
  assert.equal(hits, 0);
});

test("file: imports outside the function file refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hors-"));
  try {
    await writeFile(join(dir, "m.ts"), "export const x = 1;");
    await writeFile(join(dir, "s.json"), '{"secret":1}');
    const url = `file://${dir}`;
    for (const code of [
      `import { x } from "${url}/m.ts"; export default () => x;`,
      `import s from "${url}/s.json" with { type: "json" }; export default () => s;`,
      `export default () => import("${url}/m.ts");`,
      `export default () => import(["${url}", "m.ts"].join("/"));`,
    ])
      await assert.rejects(run(code), /import forbidden|read access/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("input named secrets kept; secrets also in the context", async () => {
  const out = await runFunction(
    {
      code: `export default (i, ctx) => ({ mine: i.secrets, ctx: ctx.secrets })`,
      permissions: { domains: [], secrets: ["A"] },
    },
    { secrets: "the user's value" },
    { secrets: { A: "a" } },
  );
  assert.deepEqual(out, { mine: "the user's value", ctx: { A: "a" } });
});

test("bounded logs; limits.timeoutMs applied and bounded", async () => {
  const { execFunction, MAX_LOGS, FunctionError } = await import("./sandbox");
  const r = await execFunction(
    {
      code: `export default () => { console.log("x".repeat(200000)); return 1; }`,
    },
    {},
  );
  assert.ok(r.logs.length <= MAX_LOGS + 40);
  assert.match(r.logs, /logs truncated/);
  await assert.rejects(
    execFunction(
      {
        code: `export default async () => { console.log("before"); await new Promise(() => setTimeout(() => {}, 60000)); }`,
        limits: { timeoutMs: 10 },
      },
      {},
    ),
    (e: unknown) =>
      e instanceof FunctionError &&
      /timeout: function killed after 1000 ms/.test(e.message),
  );
});

// A6: "*" = public internet; private/loopback/link-local IPs refused even
// when declared or resolved by DNS (localhost), unless FUNCTIONS_ALLOW_PRIVATE_NETWORK.
test("domains *: public network, private IPs and loopback blocked (anti-SSRF)", async () => {
  const srv = createServer((req, res) => {
    if (req.url === "/hop") {
      res.writeHead(302, { location: "/ok" });
      return res.end();
    }
    res.end("ok");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address() as { port: number };
  const get = (u: string) =>
    `export default async () => (await fetch(${JSON.stringify(u)})).text()`;
  const star = { permissions: { domains: ["*"], secrets: [] } };
  const env = process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
  delete process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
  try {
    for (const u of [
      `http://127.0.0.1:${port}/ok`,
      `http://localhost:${port}/ok`,
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/",
      "http://[::1]:8089/",
    ])
      await assert.rejects(
        run(get(u), {}, star),
        /net access|fetch failed|blocked/,
        u,
      );
    // WebSocket and Worker bypass the fetch guard: disabled.
    for (const expr of [
      `new WebSocket("ws://127.0.0.1:${port}/")`,
      `new Worker("data:text/javascript,1", { type: "module" })`,
    ])
      await assert.rejects(
        run(`export default () => { ${expr}; return 1; }`, {}, star),
        /blocked/,
        expr,
      );
    // Private IPv6 (fc00::/7, fe80::/10): fetch guard.
    await assert.rejects(run(get("http://[fd00::1]/"), {}, star), /blocked/);
    await assert.rejects(
      run(
        get("http://[fd00::1]/"),
        {},
        {
          permissions: { domains: ["[fd00::1]"], secrets: [] },
        },
      ),
      /blocked/,
    );
    // Explicitly declared domain: the private range stays refused.
    await assert.rejects(
      run(
        get(`http://127.0.0.1:${port}/ok`),
        {},
        {
          permissions: { domains: [`127.0.0.1:${port}`], secrets: [] },
        },
      ),
      /net access|blocked/,
    );
    // Mapped IPv4 and cloud metadata (shared filter).
    for (const u of [
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:7f00:1]/",
      "http://[fe80::1]/",
    ])
      await assert.rejects(run(get(u), {}, star), /blocked|net access/, u);
    // Explicit opt-out: reachable, redirects followed.
    process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK = "1";
    assert.equal(
      await run(get(`http://127.0.0.1:${port}/hop`), {}, star),
      "ok",
    );
  } finally {
    if (env === undefined) delete process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
    else process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK = env;
    srv.close();
  }
});

test("netFlags: nothing without domain, * = --allow-net, deny-net for private ranges", async () => {
  const { netFlags } = await import("./sandbox");
  delete process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
  assert.deepEqual(netFlags([]), []);
  const [allow, deny] = netFlags(["*"]);
  assert.equal(allow, "--allow-net");
  assert.match(
    deny!,
    /^--deny-net=.*172\.16\.0\.0\/12.*169\.254|169\.254.*172\.16/,
  );
  assert.equal(netFlags(["api.x.io"])[0], "--allow-net=api.x.io");
});

// A7: HTML parser (linkedom) as a global and in the context.
test("parseHTML and DOMParser available in the sandbox", async () => {
  const out = await run(
    `export default (_i, { parseHTML: p }) => {
      const { document } = p('<ul><li class="a">x</li><li class="a">y</li></ul><a href="/z">z</a>');
      const d = new DOMParser().parseFromString("<p id=k>v</p>", "text/html");
      return {
        items: [...document.querySelectorAll("li.a")].map((e) => e.textContent),
        href: document.querySelector("a").getAttribute("href"),
        p: d.getElementById("k").textContent,
        same: p === parseHTML,
      };
    }`,
  );
  assert.deepEqual(out, { items: ["x", "y"], href: "/z", p: "v", same: true });
});

test("clean function error: no ANSI or /tmp/fn- path", async () => {
  await assert.rejects(
    run(
      `export default () => { console.log("before"); throw new Error("boom"); }`,
    ),
    (e: Error & { logs?: string }) => {
      assert.equal(e.message, "boom");
      assert.match(e.logs ?? "", /fn\.ts:1:\d+/);
      assert.ok(!/\/fn-[A-Za-z0-9_]+\//.test(e.logs ?? ""), e.logs);
      assert.ok(!e.message.includes("\x1B"), e.message);
      assert.ok(!/\/fn-[A-Za-z0-9_]+\//.test(e.message), e.message);
      assert.ok(!e.logs?.includes("\x1B"));
      return true;
    },
  );
});

test("ok:false surfaces error before a strict outputSchema", async () => {
  await assert.rejects(
    run(
      `export default () => ({ ok: false, error: "quota exceeded" })`,
      {},
      {
        outputSchema: {
          type: "object",
          properties: { n: { type: "number" } },
          required: ["n"],
          additionalProperties: false,
        },
      },
    ),
    (e: Error & { code?: string }) => {
      assert.equal(e.message, "quota exceeded");
      assert.equal(e.code, "functions.failed");
      return true;
    },
  );
});
