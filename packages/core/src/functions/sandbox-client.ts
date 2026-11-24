// Sandbox service client: the function runs in the
// `sandbox` container (non-root, read-only FS, egress only, outside the
// internal network). A single HTTP request, NDJSON in both directions:
//   request : 1st line = job, then answers to SDK calls `{id,value|error}`
//   response: `{rpc}` (records.* / events.*), then `{done}` or `{fail}`.
// The records/events SDK is therefore served by the caller (web or worker), with
// its tenant context: the container opens no connection to the platform
// and has neither DB nor Redis. The SANDBOX_TOKEN authenticates the caller.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { AppError } from "../errors/app-error";
import {
  FunctionError,
  LIMITS,
  type SandboxFunction,
  type SandboxOptions,
} from "./sandbox";

export type SandboxJob = {
  f: SandboxFunction;
  input: unknown;
  secrets: Record<string, string>;
  test: boolean;
  timeoutMs?: number;
  memoryMb?: number;
  bridge: boolean;
};

export type SandboxFailure = {
  message: string;
  logs: string;
  code?: string;
  params?: Record<string, string | number>;
};

// Error returned by the container: code and params kept (web translation).
export function failureError(e: SandboxFailure) {
  return e.code && e.code !== "functions.failed"
    ? Object.assign(new AppError(e.code, e.message, e.params ?? {}), {
        logs: e.logs,
      })
    : new FunctionError(e.message, e.logs);
}

export function execRemote(
  url: string,
  f: SandboxFunction,
  input: unknown,
  { secrets = {}, host, test, timeoutMs, memoryMb }: SandboxOptions = {},
): Promise<{ output: unknown; logs: string }> {
  const declared = f.permissions?.secrets ?? [];
  const job: SandboxJob = {
    f,
    input,
    // Only declared secrets leave the process.
    secrets: Object.fromEntries(
      declared.filter((n) => n in secrets).map((n) => [n, secrets[n]!]),
    ),
    test: test === true,
    timeoutMs,
    memoryMb,
    bridge: !!host,
  };
  const u = new URL("/exec", url);
  const req = u.protocol === "https:" ? httpsRequest : httpRequest;
  // Margin beyond the function timeout (import analysis, transport).
  const deadline =
    Math.min(
      timeoutMs ?? f.limits?.timeoutMs ?? LIMITS.timeoutMs.default,
      LIMITS.timeoutMs.max,
    ) *
      2 +
    10_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const r = req(u, {
      method: "POST",
      headers: {
        "content-type": "application/x-ndjson",
        authorization: `Bearer ${process.env.SANDBOX_TOKEN ?? ""}`,
      },
    });
    const timer = setTimeout(() => {
      r.destroy();
      finish(() =>
        reject(
          new FunctionError(
            `timeout: sandbox did not answer within ${deadline} ms`,
            "",
          ),
        ),
      );
    }, deadline);
    const send = (m: unknown) => {
      if (!r.writableEnded) r.write(JSON.stringify(m) + "\n");
    };
    r.on("error", (e) =>
      finish(() =>
        reject(new FunctionError(`sandbox unavailable: ${e.message}`, "")),
      ),
    );
    r.on("response", (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return finish(() =>
          reject(new FunctionError(`sandbox HTTP ${res.statusCode}`, "")),
        );
      }
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const m = JSON.parse(line) as {
            rpc?: { id: number; method: string; args: unknown[] };
            done?: { output: unknown; logs: string };
            fail?: SandboxFailure;
          };
          if (m.rpc) {
            const { id, method, args } = m.rpc;
            (host
              ? host(method, args)
              : Promise.reject(
                  // eslint-disable-next-line no-restricted-syntax -- relayed to the sandbox
                  new Error(`${method} unavailable`),
                )
            ).then(
              (value) => send({ id, value: value ?? null }),
              (e: Error) => send({ id, error: e.message }),
            );
          } else if (m.done) {
            const done = m.done;
            r.end();
            finish(() => resolve(done));
          } else if (m.fail) {
            const fail = m.fail;
            r.end();
            finish(() => reject(failureError(fail)));
          }
        }
      });
      res.on("end", () =>
        finish(() =>
          reject(new FunctionError("sandbox closed the stream", "")),
        ),
      );
    });
    send(job);
  });
}
