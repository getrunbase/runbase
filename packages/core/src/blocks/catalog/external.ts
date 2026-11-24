// External blocks. `{{secret.X}}` values are resolved only here, at
// call time; output and errors are redacted of secret values
// before being persisted in the run steps.
import { createHmac } from "node:crypto";
import { z } from "zod";
import { defineBlock, type BlockContext } from "../block";
import { render } from "../render";
import { redact as redactValues } from "../../secrets";
import { AppError, appError, notFound } from "../../errors/app-error";
import { safeFetch } from "../../lib/safe-fetch";
import type { WorkspaceSettings } from "../../workspaces";

const headers = z.record(z.string(), z.string()).default({});

// Allowed domain: equal to an entry or a subdomain of it.
export function assertAllowed(url: string, allowed: string[]) {
  const host = new URL(url).hostname.toLowerCase();
  const ok = allowed.some((d) => {
    const dom = d.toLowerCase();
    return host === dom || host.endsWith(`.${dom}`);
  });
  if (!ok)
    throw appError("blocks.domainNotAllowed", "Domain not allowed: {host}", {
      host,
    });
}

export const redact = (text: string, s: WorkspaceSettings) =>
  redactValues(text, s.secrets);

// Runs `fn` with resolved secrets; everything coming out is redacted.
export async function withSecrets<T>(
  ctx: BlockContext,
  input: unknown,
  fn: (resolved: unknown, s: WorkspaceSettings) => Promise<T>,
): Promise<T> {
  const s = await ctx.settings();
  try {
    const out = await fn(render(input, { secret: s.secrets }), s);
    return JSON.parse(redact(JSON.stringify(out), s)) as T;
  } catch (e) {
    // Displayable error (http.blockedAddress…): code kept for translation.
    if (e instanceof AppError) throw e;
    // Foreign error: relayed as is, secrets redacted.
    // eslint-disable-next-line no-restricted-syntax -- relayed message
    throw new Error(redact((e as Error).message, s));
  }
}

async function send(
  s: WorkspaceSettings,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  signal: AbortSignal,
) {
  assertAllowed(url, s.allowedDomains);
  // IP checked at connection (anti-SSRF); no redirect.
  const res = await safeFetch(url, { ...init, signal });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON body: kept as text.
  }
  return { status: res.status, body, ok: res.ok };
}

const encode = (body: unknown) =>
  body === undefined || typeof body === "string"
    ? (body as string | undefined)
    : JSON.stringify(body);

export const httpRequest = defineBlock({
  type: "http.request",
  label: "HTTP request",
  description: "Calls an external URL and returns the response.",
  sideEffect: true,
  inputSchema: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.string(),
    headers,
    body: z.unknown().optional(),
  }),
  outputSchema: z.object({ status: z.number(), body: z.unknown() }),
  branches: ["ok", "error"],
  run: async (input, ctx) =>
    withSecrets(ctx, input, async (r, s) => {
      const { method, url, headers, body } = r as typeof input;
      const json = body !== undefined && typeof body !== "string";
      const res = await send(
        s,
        url,
        {
          method,
          headers: json
            ? { "content-type": "application/json", ...headers }
            : headers,
          body: encode(body),
        },
        ctx.signal,
      );
      return {
        branch: res.ok ? "ok" : "error",
        output: { status: res.status, body: res.body },
      };
    }),
});

// Signed JSON POST: `x-runbase-signature: sha256=<hex hmac of the body>`.
export const webhookEmit = defineBlock({
  type: "webhook.emit",
  label: "Send a webhook",
  description: "Sends a signed payload to a URL.",
  sideEffect: true,
  inputSchema: z.object({
    url: z.string(),
    // Name of the workspace secret used as HMAC key.
    secret: z.string().min(1),
    payload: z.unknown(),
  }),
  outputSchema: z.object({ status: z.number() }),
  branches: ["ok", "error"],
  run: async (input, ctx) =>
    withSecrets(ctx, input, async (r, s) => {
      const { url, secret, payload } = r as typeof input;
      const key = s.secrets[secret];
      if (!key)
        throw notFound("blocks.unknownSecret", "Unknown secret: {secret}", {
          secret,
        });
      const body = JSON.stringify(payload ?? null);
      const sig = createHmac("sha256", key).update(body).digest("hex");
      const res = await send(
        s,
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-runbase-signature": `sha256=${sig}`,
          },
          body,
        },
        ctx.signal,
      );
      return {
        branch: res.ok ? "ok" : "error",
        output: { status: res.status },
      };
    }),
});

// JSON-RPC response, as JSON or SSE (Streamable HTTP transport).
function rpcResult(res: { body: unknown }, id: number) {
  const msgs =
    typeof res.body === "string"
      ? res.body
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => JSON.parse(l.slice(5)))
      : [res.body];
  const msg = msgs.find((m) => m?.id === id);
  if (!msg) throw appError("blocks.mcpInvalidResponse", "Invalid MCP response");
  if (msg.error)
    throw appError("blocks.mcpError", "MCP: {message}", {
      message: String(msg.error.message),
    });
  return msg.result;
}

// Calls a tool of an MCP server configured in the workspace.
export const mcpCall = defineBlock({
  type: "mcp.call",
  label: "MCP call",
  description: "Calls a tool on a configured MCP server.",
  sideEffect: true,
  inputSchema: z.object({
    server: z.string().min(1),
    tool: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
  outputSchema: z.object({ result: z.unknown() }),
  branches: ["ok", "error"],
  run: async (input, ctx) =>
    withSecrets(ctx, input, async (r, s) => {
      const { server, tool, arguments: args } = r as typeof input;
      const conf = s.mcpServers[server];
      if (!conf)
        throw notFound("blocks.unknownMcpServer", "Unknown MCP server: {server}", {
          server,
        });
      const base = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(render(conf.headers ?? {}, { secret: s.secrets }) as Record<
          string,
          string
        >),
      };
      const call = async (
        body: object,
        session?: string,
      ): Promise<{ body: unknown; session?: string }> => {
        assertAllowed(conf.url, s.allowedDomains);
        const res = await safeFetch(conf.url, {
          method: "POST",
          headers: session ? { ...base, "mcp-session-id": session } : base,
          body: JSON.stringify(body),
          signal: ctx.signal,
        });
        if (!res.ok && res.status !== 202)
          throw appError("blocks.mcpHttp", "MCP HTTP {status}", {
            status: res.status,
          });
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Non-JSON body: kept as text.
        }
        return {
          body: parsed,
          session: res.headers.get("mcp-session-id") ?? session,
        };
      };
      const init = await call({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "runbase", version: "1" },
        },
      });
      rpcResult(init, 1);
      await call(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        init.session,
      );
      const res = await call(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: tool, arguments: args },
        },
        init.session,
      );
      const result = rpcResult(res, 2) as { isError?: boolean };
      return { branch: result?.isError ? "error" : "ok", output: { result } };
    }),
});

// Emits an internal event: triggers `trigger.event` workflows.
export const eventEmit = defineBlock({
  type: "event.emit",
  label: "Emit an event",
  description: "Publishes an event that can trigger other workflows.",
  sideEffect: true,
  inputSchema: z.object({
    type: z.string().min(1),
    recordId: z.string().nullish(),
    payload: z.record(z.string(), z.unknown()).default({}),
    // Date of the fact (ISO), default: now.
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    // External id: one id creates only one event (replay, several runs).
    idempotencyKey: z.string().min(1).optional(),
  }),
  outputSchema: z.object({ eventId: z.string(), duplicate: z.boolean() }),
  branches: ["ok"],
  // Idempotent on retry: without a provided key, the step key is used.
  run: async (
    { type, recordId, payload, occurredAt, idempotencyKey },
    { services, depth, key },
  ) => {
    const ev = await services.events.insert({
      type,
      recordId,
      payload,
      source: "workflow",
      depth: depth + 1,
      occurredAt: occurredAt ? new Date(occurredAt) : undefined,
      idempotencyKey: idempotencyKey ?? (key ? `run:${key}` : null),
    });
    return {
      branch: "ok",
      output: { eventId: ev.id, duplicate: ev.duplicate },
    };
  },
});

// Slack message through an Incoming Webhook. The URL can be `{{secret.SLACK_WEBHOOK}}`.
// Domain fixed to hooks.slack.com: no need to add it to the allowed domains.
export const slackSend = defineBlock({
  type: "slack.send",
  label: "Slack message",
  description: "Sends a message to Slack through an Incoming Webhook URL.",
  sideEffect: true,
  inputSchema: z.object({
    webhookUrl: z.string().min(1),
    text: z.string().min(1),
  }),
  outputSchema: z.object({ status: z.number() }),
  branches: ["ok", "error"],
  run: async (input, ctx) =>
    withSecrets(ctx, input, async (r) => {
      const { webhookUrl, text } = r as typeof input;
      if (!webhookUrl.startsWith("https://hooks.slack.com/"))
        throw appError("blocks.invalidSlackUrl", "Invalid Slack webhook URL");
      const res = await safeFetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ctx.signal,
      });
      return {
        branch: res.ok ? "ok" : "error",
        output: { status: res.status },
      };
    }),
});
