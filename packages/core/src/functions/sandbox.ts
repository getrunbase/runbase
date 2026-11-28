// Sandbox runtime: each function runs in a `deno run`
// subprocess without --allow-read/write/env/run; only network to the declared
// domains is allowed. JSON I/O on stdin/stdout, validated against the
// schemas; only declared secrets are injected into the input (`secrets`).
// Imports: --no-remote/--no-npm block https:, npm: and jsr: (Deno would
// otherwise download them without checking --allow-net); literal local imports
// (static or dynamic) bypass --allow-read, so the module graph
// (`deno info`) must be limited to main.ts and fn.ts. Computed dynamic
// imports stay subject to --allow-read, never granted.
import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { AppError, appError, type ErrorInfo } from "../errors/app-error";
import { env } from "../env";
// Bundled linkedom (scripts/vendor-linkedom.sh): parseHTML and DOMParser
// in the sandbox, written next to fn.ts (no npm import at runtime).
import LINKEDOM from "./linkedom.gen";
import { execRemote } from "./sandbox-client";
import { cleanError, cleanText, thrownMessage } from "../errors/clean";
import { IP_FILTER_JS, privateNetworkAllowed } from "../lib/ip-filter";

export type SandboxFunction = {
  code: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  limits?: { timeoutMs?: number; memoryMb?: number };
  permissions?: {
    domains: string[];
    secrets: string[];
    records?: "read" | "write";
    events?: "read" | "write";
  };
};

// Host bridge (fn-sdk): call of a `records.*` method (`get`, `search`…) or
// `events.*` (`events.push`, `events.list`) from the sandbox, executed on the
// host side (packages/core services, scoped to the workspace).
export type HostBridge = (method: string, args: unknown[]) => Promise<unknown>;

// Bounds of per-function limits (`limits` of functions.save).
export const LIMITS = {
  timeoutMs: { min: 1_000, max: 120_000, default: 30_000 },
  memoryMb: { min: 32, max: 512, default: 128 },
};
// Logs (stderr) kept at most: beyond that, truncated.
export const MAX_LOGS = 64_000;

// Execution failure: keeps the logs produced before the error.
export class FunctionError extends AppError {
  constructor(
    message: string,
    readonly logs: string,
    info: ErrorInfo = { code: "functions.failed" },
  ) {
    super(info.code, message, info.params);
  }
}

// Bounded stderr accumulator.
function boundedLog() {
  let text = "";
  let cut = false;
  return {
    add(d: unknown) {
      if (cut) return;
      text += String(d);
      if (text.length > MAX_LOGS) {
        text = text.slice(0, MAX_LOGS) + "\n… (logs truncated)";
        cut = true;
      }
    },
    // Without ANSI or /tmp/fn-… paths.
    get text() {
      return cleanText(text);
    },
  };
}

export type SandboxOptions = {
  secrets?: Record<string, string>;
  timeoutMs?: number;
  memoryMb?: number;
  host?: HostBridge;
  // Execution inside a test run (A4): `ctx.test` on the function side.
  test?: boolean;
  // Step signal: abort = Deno process killed.
  signal?: AbortSignal;
};

// console.* goes to stderr: stdout only carries JSON messages (one per
// line): `{rpc}` (records.* call to the host) then `{out}` (result).
// stdin: 1st line = input, following lines = answers to rpc calls.
const WRAPPER = `import "./guard.js";
import { parseHTML, DOMParser } from "./html.js";
import fn from "./fn.ts";
globalThis.parseHTML = parseHTML;
globalThis.DOMParser = DOMParser;
console.log = console.info = console.debug = console.error;
const reader = Deno.stdin.readable.pipeThrough(new TextDecoderStream()).getReader();
let buf = "";
async function line() {
  for (;;) {
    const i = buf.indexOf("\\n");
    if (i >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); return l; }
    const { value, done } = await reader.read();
    if (done) { const l = buf; buf = ""; return l; }
    buf += value;
  }
}
const enc = new TextEncoder();
async function send(m) {
  let b = enc.encode(JSON.stringify(m) + "\\n");
  while (b.length) b = b.subarray(await Deno.stdout.write(b));
}
let seq = 0, queue = Promise.resolve();
const call = (method, args) => {
  const p = queue.then(async () => {
    const id = ++seq;
    await send({ rpc: { id, method, args } });
    const r = JSON.parse(await line());
    if (r.error) throw new Error(r.error);
    return r.value;
  });
  queue = p.catch(() => {});
  return p;
};
const records = Object.freeze(Object.fromEntries(
  ["get", "search", "upsert", "update", "transact", "delete", "merge"].map((m) => [m, (...a) => call(m, a)]),
));
const events = Object.freeze({
  push: (...a) => call("events.push", a),
  list: (...a) => call("events.list", a),
});
globalThis.records = records;
globalThis.events = events;
const { input, secrets, test } = JSON.parse(await line());
// Secrets also in input.secrets (legacy), unless the input already has that field.
const arg = "secrets" in input ? input : { ...input, secrets };
const out = await fn(arg, { records, events, secrets, test: test === true, parseHTML });
await send({ out: out ?? null });
`;

// Anti-SSRF (A6). Private IPv4 ranges, loopback, link-local (cloud
// metadata 169.254.169.254), CGNAT: --deny-net, which Deno also checks on
// the DNS-resolved IP, on each redirect (and on mapped IPv6).
// Can be disabled (dev, tests, self-hosting): FUNCTIONS_ALLOW_PRIVATE_NETWORK=1.
export const PRIVATE_NETS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "[::1]",
  "[::]",
  "localhost",
];
const privateNetAllowed = privateNetworkAllowed;

// Deno does not accept IPv6 CIDRs in --deny-net: as soon as a domain is
// allowed, this module (loaded before fn.ts) checks each host with the shared
// filter (lib/ip-filter): literal IP, otherwise all its
// A and AAAA addresses (ULA, link-local, v6 loopback, mapped IPv4), in fetch
// (redirects followed by hand, each hop checked) and
// Deno.connect/connectTls. IPv4 ranges also stay in --deny-net,
// which Deno applies on the actually connected IP (anti DNS rebinding).
// WebSocket, WebSocketStream and Worker (own fetch, no guard) are disabled.
const GUARD = `const blockedAddress = ${IP_FILTER_JS};
const check = async (host) => {
  const h = String(host).replace(/^\\[|\\]$/g, "");
  const literal = /^[\\d.]+$/.test(h) || h.includes(":");
  const addrs = literal ? [h] : (await Promise.all(["A", "AAAA"].map((t) => Deno.resolveDns(h, t).catch(() => [])))).flat();
  if (h === "localhost" || addrs.some((a) => blockedAddress(a, false))) throw new TypeError("blocked: " + h + " resolves to a private network address");
};
const rawFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let req = new Request(input, init);
  const mode = req.redirect;
  for (let hop = 0; hop < 20; hop++) {
    await check(new URL(req.url).hostname);
    const res = await rawFetch(req.clone(), { redirect: "manual" });
    const loc = res.headers.get("location");
    if (mode !== "follow" || res.status < 300 || res.status > 399 || !loc) return res;
    const url = new URL(loc, req.url);
    const from = new URL(req.url).origin;
    req = res.status === 303 || ((res.status === 301 || res.status === 302) && req.method === "POST")
      ? new Request(url, { method: "GET", headers: req.headers })
      : new Request(url, req);
    // Like native fetch: no credentials to another origin.
    if (url.origin !== from) for (const h of ["authorization", "cookie", "proxy-authorization"]) req.headers.delete(h);
  }
  throw new TypeError("too many redirects");
};
for (const k of ["connect", "connectTls"]) {
  const raw = Deno[k];
  Deno[k] = async (o) => (await check(o.hostname ?? "127.0.0.1"), raw(o));
}
for (const k of ["WebSocket", "WebSocketStream", "Worker"]) {
  const disabled = class { constructor() { throw new TypeError("blocked: " + k + " is not available in functions"); } };
  Object.defineProperty(globalThis, k, { value: disabled, writable: false, configurable: false });
}
`;

// permissions.domains domains: exact "*" (public internet),
// otherwise a host name (FQDN, IPv4) with optional port. No comma,
// space or scheme: the value goes as is into --allow-net.
// Wildcards refused: Deno --allow-net does not understand them. `*.tld` is too
// broad; `*.example.com` refused too (list each subdomain), so as not
// to widen --allow-net to the whole internet filtered only by the preamble.
const LABEL = "(?!-)[a-z0-9-]{1,63}(?<!-)";
// Literal IPv6 in brackets accepted ([2001:db8::1]:443).
const HOST = new RegExp(
  `^(${LABEL}(\\.${LABEL})*|\\[[0-9a-f:.]+\\])(:\\d{1,5})?$`,
  "i",
);

export function domainError(d: unknown): AppError | null {
  const domain = String(d);
  if (domain === "*") return null;
  if (/^\*\.[^.]+$/.test(domain))
    return appError(
      "functions.invalidDomain",
      "Invalid domain {domain}: wildcard top-level domains are not allowed",
      { domain },
    );
  if (domain.startsWith("*."))
    return appError(
      "functions.wildcardDomain",
      'Invalid domain {domain}: wildcards are not supported, list each host (or "*" for any public host)',
      { domain },
    );
  const port = Number(/:(\d+)$/.exec(domain.replace(/^\[.*\]/, ""))?.[1] ?? 1);
  if (typeof d !== "string" || !HOST.test(domain) || port < 1 || port > 65535)
    return appError(
      "functions.malformedDomain",
      "Invalid domain {domain}: expected a hostname or host:port, without scheme, comma or space",
      { domain },
    );
  return null;
}

export function assertDomains(domains: unknown[] | undefined) {
  for (const d of domains ?? []) {
    const e = domainError(d);
    if (e) throw e;
  }
}

// deno run network arguments: nothing without domain; "*" = public internet.
// Domains revalidated here (old functions in DB): clear error rather
// than a Deno crash or a host injection through a comma.
export function netFlags(domains: string[]): string[] {
  if (!domains.length) return [];
  assertDomains(domains);
  const allow = domains.includes("*")
    ? "--allow-net"
    : `--allow-net=${domains.join(",")}`;
  return privateNetAllowed()
    ? [allow]
    : [allow, `--deny-net=${PRIVATE_NETS.join(",")}`];
}

// Readable zod errors: `leadId: expected string, received
// undefined` rather than a JSON dump of the issues.
export function zodIssues(e: z.ZodError) {
  const issues = e.issues.map((i) => ({
    path: i.path.length ? i.path.join(".") : "(root)",
    message: i.message.replace(/^Invalid input: /, ""),
  }));
  return {
    path: [...new Set(issues.map((i) => i.path))].join(", "),
    message: [...new Set(issues.map((i) => i.message))].join("; "),
  };
}

// Validates against a JSON Schema; failure = readable displayable error.
export function validateSchema(
  schema: Record<string, unknown> | undefined,
  v: unknown,
  kind: "input" | "output",
) {
  if (!schema || !Object.keys(schema).length) return v;
  const r = z.fromJSONSchema(schema as never).safeParse(v);
  if (r.success) return r.data;
  const params = zodIssues(r.error);
  throw kind === "input"
    ? appError(
        "functions.invalidInput",
        "Invalid input {path}: {message}",
        params,
      )
    : appError(
        "functions.invalidOutput",
        "Invalid output {path}: {message} (outputSchema)",
        params,
      );
}

const bounded = (k: keyof typeof LIMITS, v: number | undefined) =>
  Math.min(Math.max(v ?? LIMITS[k].default, LIMITS[k].min), LIMITS[k].max);

export async function runFunction(
  f: SandboxFunction,
  input: unknown,
  opts?: SandboxOptions,
): Promise<unknown> {
  return (await execFunction(f, input, opts)).output;
}

// Like runFunction, with the execution logs (console.*).
// SANDBOX_URL set: execution in the `sandbox` container
// (non-root, outside the internal network), records/events SDK relayed through the stream.
export function execFunction(
  f: SandboxFunction,
  input: unknown,
  opts: SandboxOptions = {},
): Promise<{ output: unknown; logs: string }> {
  return process.env.SANDBOX_URL
    ? execRemote(process.env.SANDBOX_URL, f, input, opts)
    : execLocal(f, input, opts);
}

// Execution in this process (dev, tests, the sandbox service itself).
export async function execLocal(
  f: SandboxFunction,
  input: unknown,
  { secrets = {}, host, test, signal, ...opts }: SandboxOptions = {},
): Promise<{ output: unknown; logs: string }> {
  const timeoutMs = bounded("timeoutMs", opts.timeoutMs ?? f.limits?.timeoutMs);
  const memoryMb = bounded("memoryMb", opts.memoryMb ?? f.limits?.memoryMb);
  const data = validateSchema(f.inputSchema, input, "input");
  const declared = f.permissions?.secrets ?? [];
  const domains = f.permissions?.domains ?? [];
  assertDomains(domains);
  const payload = {
    input: { ...(data as object) },
    secrets: Object.fromEntries(
      declared.filter((n) => n in secrets).map((n) => [n, secrets[n]]),
    ),
    test: test === true,
  };

  // realpath: on macOS, tmpdir() goes through a symlink (/var).
  const dir = await realpath(await mkdtemp(join(tmpdir(), "fn-")));
  try {
    await writeFile(join(dir, "fn.ts"), f.code);
    await writeFile(join(dir, "main.ts"), WRAPPER);
    await writeFile(join(dir, "html.js"), LINKEDOM);
    const guarded = domains.length > 0 && !privateNetAllowed();
    await writeFile(join(dir, "guard.js"), guarded ? GUARD : "");
    const isolation = ["--no-config", "--no-remote", "--no-npm"];
    const main = join(dir, "main.ts");
    const allowed = new Set(
      ["main.ts", "fn.ts", "html.js", "guard.js"].map(
        (f) => pathToFileURL(join(dir, f)).href,
      ),
    );
    const graph = JSON.parse(
      (
        await spawnDeno(
          ["info", "--json", ...isolation, main],
          "",
          timeoutMs,
          "import analysis",
          signal,
        )
      )[0],
    ) as { modules: { specifier: string }[] };
    const outside = graph.modules
      .map((m) => m.specifier)
      .filter((s) => !allowed.has(s));
    if (outside.length)
      throw appError(
        "functions.importForbidden",
        "import forbidden: {modules}",
        {
          modules: outside.join(", "),
        },
      );

    const [out, logs] = await runDeno(
      [
        "run",
        "--no-prompt",
        ...isolation,
        `--v8-flags=--max-old-space-size=${memoryMb}`,
        ...netFlags(domains),
        main,
      ],
      JSON.stringify(payload),
      timeoutMs,
      host,
      signal,
    );
    // { ok: false, error } is an explicit failure: reported as-is,
    // before the outputSchema check (which would hide the real cause).
    if (isFailure(out))
      throw new FunctionError(
        cleanError(
          typeof out.error === "string" && out.error.trim()
            ? out.error
            : JSON.stringify(out.error ?? "function returned ok: false"),
        ),
        logs,
      );
    try {
      return { output: validateSchema(f.outputSchema, out, "output"), logs };
    } catch (e) {
      const a = e as AppError;
      throw new FunctionError(a.message, logs, {
        code: a.code,
        params: a.params,
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const isFailure = (o: unknown): o is { ok: false; error?: unknown } =>
  !!o && typeof o === "object" && (o as { ok?: unknown }).ok === false;

// Deno process env: empty except the bare minimum, never
// process.env (DATABASE_URL, REDIS_URL, master keys…). Without --allow-env,
// Deno.env stays inaccessible to the function code anyway.
// Tenant secrets go through stdin (permissions.secrets), not through env.
export const denoEnv = (): Record<string, string> => ({
  NO_COLOR: "1",
  DENO_NO_UPDATE_CHECK: "1",
  PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  ...(process.env.DENO_DIR ? { DENO_DIR: process.env.DENO_DIR } : {}),
  ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
});

function spawnDeno(
  args: string[],
  stdin: string,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<[string, string]> {
  return new Promise((resolve, reject) => {
    // Step abort: the process is killed (SIGKILL), the promise rejects.
    const p = spawn(env().DENO_BIN, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: denoEnv() as NodeJS.ProcessEnv,
      signal,
      killSignal: "SIGKILL",
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(
        appError("functions.timeout", "timeout: {label} killed after {ms} ms", {
          label,
          ms: timeoutMs,
        }),
      );
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => (clearTimeout(timer), reject(e)));
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve([out, err]);
      else
        reject(
          appError(
            "functions.processFailed",
            "{label} failed ({code}): {detail}",
            {
              label,
              code: String(code),
              detail: cleanError(err.trim()),
            },
          ),
        );
    });
    p.stdin.end(stdin);
  });
}

// Runs the function with the WRAPPER line protocol: the
// `{rpc}` are served by `host` (refused without bridge), `{out}` is the result.
function runDeno(
  args: string[],
  input: string,
  timeoutMs: number,
  host?: HostBridge,
  signal?: AbortSignal,
): Promise<[unknown, string]> {
  return new Promise((resolve, reject) => {
    // Step abort: the process is killed (SIGKILL), the promise rejects.
    const p = spawn(env().DENO_BIN, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: denoEnv() as NodeJS.ProcessEnv,
      signal,
      killSignal: "SIGKILL",
    });
    let buf = "";
    const err = boundedLog();
    let result: { out: unknown } | undefined;
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(
        new FunctionError(
          `timeout: function killed after ${timeoutMs} ms (limits.timeoutMs)`,
          err.text,
        ),
      );
    }, timeoutMs);
    const reply = (m: unknown) => {
      if (p.stdin.writable) p.stdin.write(JSON.stringify(m) + "\n");
    };
    const handle = (l: string) => {
      if (!l.trim()) return;
      const m = JSON.parse(l) as {
        rpc?: { id: number; method: string; args: unknown[] };
        out?: unknown;
      };
      if (m.rpc) {
        const { id, method, args } = m.rpc;
        (host
          ? host(method, Array.isArray(args) ? args : [])
          : Promise.reject(
              appError(
                "functions.rpcUnavailable",
                "{method} unavailable: permissions.records or permissions.events required",
                { method },
              ),
            )
        ).then(
          (value) => reply({ id, value: value ?? null }),
          (e: Error) => reply({ id, error: e.message }),
        );
      } else if ("out" in m) {
        result = { out: m.out };
        p.stdin.end();
      }
    };
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          handle(l);
        } catch {
          // non-JSON output: ignored (only WRAPPER messages count)
        }
      }
    });
    p.stderr.on("data", (d) => err.add(d));
    p.stdin.on("error", () => {});
    p.on("error", (e) => (clearTimeout(timer), reject(e)));
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && result) resolve([result.out, err.text]);
      else
        reject(
          new FunctionError(
            thrownMessage(err.text) ??
              cleanError(`function failed (${code}): ${err.text.trim()}`),
            cleanText(err.text),
          ),
        );
    });
    p.stdin.write(input + "\n");
  });
}
