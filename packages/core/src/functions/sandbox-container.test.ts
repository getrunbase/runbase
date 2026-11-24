// `sandbox` image started as in docker-compose.yml: non-root,
// read-only FS (tmpfs /tmp), outside the postgres and redis network.
// Opt-in (Docker required):
//   docker build --target sandbox -t runbase-sandbox .
//   SANDBOX_IMAGE=runbase-sandbox pnpm --filter @getrunbase/core test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { execFunction } from "./sandbox";

const IMAGE = process.env.SANDBOX_IMAGE;
const skip =
  !IMAGE && "SANDBOX_IMAGE not set (sandbox image not built)";
const id = `sbx-test-${process.pid}`;
const TOKEN = `token-${crypto.randomUUID()}`;
const docker = (...args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" }).trim();
// Command in the sandbox container: [exit code, output].
const inSandbox = (...cmd: string[]): [number, string] => {
  try {
    return [0, docker("exec", id, ...cmd)];
  } catch (e) {
    const x = e as { status: number; stdout: string; stderr: string };
    return [x.status, `${x.stdout}${x.stderr}`];
  }
};
const tcp = (host: string, port: number) =>
  `require("net").connect({host:"${host}",port:${port},timeout:2000})` +
  `.on("connect",()=>process.exit(0)).on("timeout",()=>process.exit(3))` +
  `.on("error",(e)=>{console.error(e.code);process.exit(2)})`;

let url = "";
const targets: Record<string, string> = {};

before(async () => {
  if (skip) return;
  // Simulated "internal" network: postgres:5432 and redis:6379 (redis-server
  // on both ports, a listening service is enough).
  docker("network", "create", "--internal", `${id}-internal`);
  docker("network", "create", `${id}-egress`);
  for (const [name, port] of [
    ["postgres", 5432],
    ["redis", 6379],
  ] as const) {
    docker(
      "run",
      "-d",
      "--name",
      `${id}-${name}`,
      "--network",
      `${id}-internal`,
      "--network-alias",
      name,
      "redis:7-alpine",
      "redis-server",
      "--port",
      String(port),
    );
    targets[name] = docker(
      "inspect",
      "-f",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      `${id}-${name}`,
    );
  }
  docker(
    "run",
    "-d",
    "--name",
    id,
    "--user",
    "node",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    "256",
    "--network",
    `${id}-egress`,
    "-e",
    `SANDBOX_TOKEN=${TOKEN}`,
    "-p",
    "127.0.0.1::7200",
    IMAGE!,
  );
  const port = docker("port", id, "7200").split(":").pop();
  url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (/listening/.test(docker("logs", id))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`sandbox not started: ${docker("logs", id)}`);
});

after(() => {
  if (skip) return;
  for (const c of [id, `${id}-postgres`, `${id}-redis`])
    try {
      docker("rm", "-f", c);
    } catch {
      // already removed
    }
  for (const n of ["internal", "egress"])
    try {
      docker("network", "rm", `${id}-${n}`);
    } catch {
      // already removed
    }
});

const remote = <T>(fn: () => Promise<T>) => {
  process.env.SANDBOX_URL = url;
  process.env.SANDBOX_TOKEN = TOKEN;
  return fn().finally(() => {
    delete process.env.SANDBOX_URL;
    delete process.env.SANDBOX_TOKEN;
  });
};

test("non-root process, read-only FS except /tmp", { skip }, () => {
  assert.notEqual(inSandbox("id", "-u")[1], "0");
  assert.notEqual(inSandbox("touch", "/app/x")[0], 0);
  assert.notEqual(inSandbox("touch", "/x")[0], 0);
  assert.equal(inSandbox("touch", "/tmp/x")[0], 0);
});

test("container env without infra variables", { skip }, () => {
  const env = inSandbox("env")[1];
  for (const k of [
    "DATABASE_URL",
    "REDIS_URL",
    "SECRETS_MASTER_KEY",
    "DEEPSEEK_API_KEY",
  ])
    assert.doesNotMatch(env, new RegExp(`^${k}=`, "m"));
});

test(
  "postgres:5432 and redis:6379 unreachable from the container",
  { skip },
  () => {
    // Control: the targets answer from the internal network.
    const ping = (host: string, port: number) =>
      docker(
        "run",
        "--rm",
        "--network",
        `${id}-internal`,
        "redis:7-alpine",
        "redis-cli",
        "-h",
        host,
        "-p",
        String(port),
        "ping",
      );
    assert.equal(ping("postgres", 5432), "PONG");
    assert.equal(ping("redis", 6379), "PONG");
    for (const [name, port] of [
      ["postgres", 5432],
      ["redis", 6379],
    ] as const) {
      assert.notEqual(inSandbox("node", "-e", tcp(name, port))[0], 0, name);
      assert.notEqual(
        inSandbox("node", "-e", tcp(targets[name]!, port))[0],
        0,
        targets[name],
      );
    }
  },
);

test(
  'function: empty Deno.env, postgres/redis refused even with domains ["*"]',
  { skip },
  async () => {
    const { output } = await remote(() =>
      execFunction(
        {
          code: `export default async (i) => {
          let env; try { env = Deno.env.toObject(); } catch (e) { env = e.name; }
          const net = {};
          for (const [h, p] of i.hosts) {
            try { (await Deno.connect({ hostname: h, port: p })).close(); net[h + ":" + p] = "connected"; }
            catch (e) { net[h + ":" + p] = e.name; }
          }
          return { env, net };
        }`,
          permissions: { domains: ["*"], secrets: [] },
        },
        {
          hosts: [
            ["postgres", 5432],
            ["redis", 6379],
            [targets.postgres, 5432],
            [targets.redis, 6379],
          ],
        },
      ),
    );
    const o = output as { env: unknown; net: Record<string, string> };
    assert.equal(o.env, "NotCapable");
    assert.equal(Object.keys(o.net).length, 4);
    for (const [k, v] of Object.entries(o.net))
      assert.notEqual(v, "connected", k);
  },
);
