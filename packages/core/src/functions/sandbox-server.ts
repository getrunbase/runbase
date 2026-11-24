// Sandbox service: receives one job per request (see
// sandbox-client.ts) and runs it with execLocal (Deno, empty env). Records/events
// SDK calls go back to the caller in the response: this
// service has no database, Redis or platform secrets in its env.
// Imports only the sandbox: no DB dependency.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "../errors/app-error";
import { execLocal, FunctionError } from "./sandbox";
import type { SandboxFailure, SandboxJob } from "./sandbox-client";

// Bounded job (code + input): beyond that, refused.
const MAX_JOB = 16 * 1024 * 1024;

const authorized = (req: IncomingMessage, token: string) => {
  const got = Buffer.from(req.headers.authorization ?? "");
  const want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
};

export function createSandboxServer(token: string): Server {
  if (token.length < 16)
    // eslint-disable-next-line no-restricted-syntax -- internal sandbox protocol
    throw new Error("SANDBOX_TOKEN must be at least 16 characters");
  return createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/exec")
      return res.writeHead(404).end();
    if (!authorized(req, token)) return res.writeHead(401).end();
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.flushHeaders();
    const write = (m: unknown) => {
      if (!res.writableEnded) res.write(JSON.stringify(m) + "\n");
    };
    let buf = "";
    let started = false;
    let seq = 0;
    const pending = new Map<
      number,
      { ok: (v: unknown) => void; ko: (e: Error) => void }
    >();
    const start = (job: SandboxJob) => {
      started = true;
      const host = job.bridge
        ? (method: string, args: unknown[]) =>
            new Promise((ok, ko) => {
              const id = ++seq;
              pending.set(id, { ok, ko });
              write({ rpc: { id, method, args } });
            })
        : undefined;
      execLocal(job.f, job.input, {
        secrets: job.secrets,
        test: job.test,
        timeoutMs: job.timeoutMs,
        memoryMb: job.memoryMb,
        host,
      }).then(
        (done) => (write({ done }), res.end()),
        (e: Error) => {
          const fail: SandboxFailure = {
            message: e.message,
            logs: e instanceof FunctionError ? e.logs : "",
            ...(e instanceof AppError
              ? { code: e.code, params: e.params }
              : {}),
          };
          write({ fail });
          res.end();
        },
      );
    };
    req.setEncoding("utf8");
    req.on("data", (d: string) => {
      buf += d;
      if (!started && buf.length > MAX_JOB) return req.destroy();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (!started) start(m as SandboxJob);
          else {
            const p = pending.get(m.id);
            pending.delete(m.id);
            // eslint-disable-next-line no-restricted-syntax -- internal sandbox protocol
            if (m.error) p?.ko(new Error(String(m.error)));
            else p?.ok(m.value);
          }
        } catch {
          req.destroy();
        }
      }
    });
    // Caller gone: pending SDK calls fail, Deno exits
    // (error or function timeout).
    req.on("close", () => {
      // eslint-disable-next-line no-restricted-syntax -- internal sandbox protocol
      for (const p of pending.values()) p.ko(new Error("caller disconnected"));
      pending.clear();
    });
  });
}
