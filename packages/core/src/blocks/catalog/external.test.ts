// External blocks: unit test (local HTTP server) then
// engine integration (requires DATABASE_URL and REDIS_URL).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Worker } from "bullmq";
import { blocks, type BlockContext } from "../index";
import { queueOptions } from "../../bus";
import { processStep, runsQueue, runsService, RUNS_QUEUE } from "../../runs";
import { workflowsService } from "../../workflows";
import { workspacesService, settingsSchema } from "../../workspaces";
import type { TenantContext } from "../../tenant";

// Test server on 127.0.0.1: private network allowed, except
// in the anti-SSRF test that removes it.
process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK = "1";
const SECRET = "s3cr3t-valeur-tres-privee";
const seen: {
  url?: string;
  headers: IncomingMessage["headers"];
  body: string;
}[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ url: req.url, headers: req.headers, body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/mcp") {
      const msg = JSON.parse(body);
      if (msg.id === undefined) return res.writeHead(202).end();
      res.setHeader("mcp-session-id", "sess");
      const result =
        msg.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: {} }
          : {
              content: [
                { type: "text", text: `echo ${msg.params.arguments.q}` },
              ],
            };
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    }
    // Returns the received auth: the output must be redacted.
    res.end(JSON.stringify({ auth: req.headers.authorization }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => setImmediate(() => process.exit(0)));

const fake = (allowedDomains: string[]): BlockContext => ({
  services: {} as BlockContext["services"],
  depth: 0,
  signal: new AbortController().signal,
  settings: async () =>
    settingsSchema.parse({
      allowedDomains,
      secrets: { API: SECRET, HOOK: "hook-key" },
      mcpServers: { local: { url: `${base}/mcp` } },
    }),
});
const run = (type: string, input: unknown, ctx: BlockContext) =>
  blocks[type]!.run(blocks[type]!.inputSchema.parse(input), ctx);

test("http.request: disallowed domain refused", async () => {
  await assert.rejects(
    run(
      "http.request",
      { url: "https://evil.example.com/x" },
      fake(["127.0.0.1"]),
    ),
    /Domain not allowed: evil\.example\.com/,
  );
  await assert.rejects(
    run("http.request", { url: `${base}/x` }, fake(["example.com"])),
    /Domain not allowed/,
  );
});

test("http.request: cloud metadata, ULA and private hostname refused (anti-SSRF)", async () => {
  const blocked = (url: string, allowed: string[]) =>
    assert.rejects(
      run("http.request", { url }, fake(allowed)),
      (e: Error & { code?: string }) =>
        e.code === "http.blockedAddress" &&
        /Address not allowed/.test(e.message),
      url,
    );
  // Always refused, even with private network allowed.
  await blocked("http://169.254.169.254/latest/meta-data/", [
    "169.254.169.254",
  ]);
  await blocked("http://[::ffff:169.254.169.254]/", ["[::ffff:a9fe:a9fe]"]);
  delete process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
  try {
    await blocked("http://[fd00::1]/", ["[fd00::1]"]);
    await blocked(`${base}/x`, ["127.0.0.1"]);
    // Hostname resolved by DNS to 127.0.0.1: refused at connection.
    const port = new URL(base).port;
    await blocked(`http://localhost:${port}/x`, ["localhost"]);
  } finally {
    process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK = "1";
  }
});

test("http.request: secret injected at call time, redacted from the output", async () => {
  const r = await run(
    "http.request",
    {
      method: "POST",
      url: `${base}/x`,
      headers: { authorization: "Bearer {{secret.API}}" },
      body: { a: 1 },
    },
    fake(["127.0.0.1"]),
  );
  assert.equal(seen.at(-1)!.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(seen.at(-1)!.body, '{"a":1}');
  assert.deepEqual(r.output, { status: 200, body: { auth: "Bearer ***" } });
});

test("webhook.emit: HMAC-signed POST", async () => {
  const r = await run(
    "webhook.emit",
    { url: `${base}/hook`, secret: "HOOK", payload: { x: 1 } },
    fake(["127.0.0.1"]),
  );
  assert.equal(r.branch, "ok");
  const last = seen.at(-1)!;
  const sig = createHmac("sha256", "hook-key").update(last.body).digest("hex");
  assert.equal(last.headers["x-runbase-signature"], `sha256=${sig}`);
});

test("event.emit: occurredAt and idempotencyKey forwarded, otherwise the step key", async () => {
  const got: Record<string, unknown>[] = [];
  const ctx = {
    ...fake([]),
    key: "run1:0:2",
    services: {
      events: {
        insert: async (i: Record<string, unknown>) => (
          got.push(i),
          { id: "e1", duplicate: false }
        ),
      },
    } as never,
  };
  await run(
    "event.emit",
    {
      type: "paid",
      occurredAt: "2026-01-02T03:04:05Z",
      idempotencyKey: "inv_1",
    },
    ctx,
  );
  await run("event.emit", { type: "paid" }, ctx);
  assert.equal(
    (got[0]!.occurredAt as Date).toISOString(),
    "2026-01-02T03:04:05.000Z",
  );
  assert.equal(got[0]!.idempotencyKey, "inv_1");
  assert.equal(got[1]!.idempotencyKey, "run:run1:0:2");
});

test("slack.send: URL outside hooks.slack.com refused", async () => {
  await assert.rejects(
    run("slack.send", { webhookUrl: `${base}/x`, text: "hi" }, fake([])),
    /Invalid Slack webhook URL/,
  );
});

test("mcp.call: calls a tool of the configured server", async () => {
  const r = await run(
    "mcp.call",
    { server: "local", tool: "echo", arguments: { q: "hi" } },
    fake(["127.0.0.1"]),
  );
  assert.deepEqual(r.output, {
    result: { content: [{ type: "text", text: "echo hi" }] },
  });
  assert.equal(seen.at(-1)!.headers["mcp-session-id"], "sess");
  await assert.rejects(
    run("mcp.call", { server: "x", tool: "t" }, fake(["127.0.0.1"])),
    /Unknown MCP server/,
  );
});

test("integration: no secret in run logs, event.emit chains", async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const [org] =
    await sql`insert into organizations (name) values ('Ext') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'Ext', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx: TenantContext = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  await workspacesService.setSettings(ctx, {
    allowedDomains: ["127.0.0.1"],
    secrets: { API: SECRET },
  });
  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
  });
  const call = (url: string) => ({
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "call",
        type: "http.request",
        input: { url, headers: { authorization: "Bearer {{secret.API}}" } },
      },
      {
        id: "emit",
        type: "event.emit",
        input: {
          type: "lead.enriched",
          payload: { status: "{{steps.call.output.status}}" },
        },
      },
    ],
    next: { call: { ok: ["emit"] } },
  });
  const wait = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const r = await runsService.get(ctx, id);
      if (r!.status !== "running") return r!;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error("timeout");
  };
  const ok = await wait(
    (await runsService.start(
      ctx,
      (
        await workflowsService.create(ctx, {
          name: "Ok",
          definition: call(`${base}/x`),
        })
      ).id,
    ))!.id,
  );
  assert.equal(ok.status, "succeeded", JSON.stringify(ok.steps));
  assert.equal(
    ok.steps[0]!.input &&
      (ok.steps[0]!.input as { headers: Record<string, string> }).headers
        .authorization,
    "Bearer {{secret.API}}",
  );
  const [ev] =
    await sql`select type from events where workspace_id = ${ws!.id}`;
  assert.equal(ev!.type, "lead.enriched");

  const ko = await wait(
    (await runsService.start(
      ctx,
      (
        await workflowsService.create(ctx, {
          name: "Ko",
          definition: call("https://evil.example.com/"),
        })
      ).id,
    ))!.id,
  );
  assert.equal(ko.status, "failed");
  assert.match(ko.error!, /Domain not allowed/);
  await worker.close();

  const [dump] =
    await sql`select coalesce(string_agg(s::text, ''), '') || coalesce((select string_agg(r::text, '') from workflow_runs r where workspace_id = ${ws!.id}), '') || coalesce((select string_agg(a::text, '') from audit_log a where organization_id = ${org!.id}), '') as t from run_steps s where organization_id = ${org!.id}`;
  assert.ok((dump!.t as string).length > 0);
  assert.equal((dump!.t as string).includes(SECRET), false);
});
