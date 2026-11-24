// Public route limits: 413, 429, invalid signature
// refused without decryption, ingestion JSON parsed after authentication.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { secretsService } from "@runbase/core/secrets";
import { webhooksService } from "@runbase/core/webhooks";
import { clientIp } from "@/lib/request-limits";
import { middleware } from "../../../middleware";
import { POST as ingestOne } from "../ingest/[workspace]/[object]/route";
import { owner, sql } from "../mcp/test-client";
import { POST as hook } from "./[id]/route";

after(() => setImmediate(() => process.exit(0)));

// Body sent as a stream (chunked, no Content-Length).
const streamed = (url: string, size: number, headers: HeadersInit = {}) =>
  new Request(url, {
    method: "POST",
    headers,
    body: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x".repeat(size)));
        c.close();
      },
    }),
    duplex: "half",
  } as RequestInit);

// Read on every call by lib/request-limits.
process.env.BODY_MAX_BYTES = "1024";
process.env.IP_RATE_HOOKS = "3";
process.env.TRUSTED_PROXY_HOPS = "1";

test("hooks: body too large -> 413; missing signature -> 401 without decrypting", async () => {
  const ctx = await owner();
  await secretsService.set(ctx, "HOOK_SECRET", "k");
  const h = await webhooksService.create(ctx, {
    name: "lim",
    eventType: "lim.event",
    secretName: "HOOK_SECRET",
    config: { format: "hmac", header: "x-sig" } as never,
  });
  const params = { params: Promise.resolve({ id: h.id }) };
  const big = await hook(streamed("http://x/api/hooks/" + h.id, 2048), params);
  assert.equal(big.status, 413);

  // Secret deleted: an unsigned call stays 401 (refused before any
  // decryption), not 500 "Secret missing".
  await sql`delete from secrets where workspace_id = ${ctx.workspaceId}`;
  const unsigned = await hook(
    new Request("http://x/api/hooks/" + h.id, { method: "POST", body: "{}" }),
    params,
  );
  assert.equal(unsigned.status, 401);
  // Signed (header present): the secret is then read.
  const signed = await hook(
    new Request("http://x/api/hooks/" + h.id, {
      method: "POST",
      body: "{}",
      headers: { "x-sig": "abc" },
    }),
    params,
  );
  assert.equal(signed.status, 500);
});

test("ingest: body too large -> 413; invalid JSON without key -> 401", async () => {
  const params = {
    params: Promise.resolve({ workspace: crypto.randomUUID(), object: "o" }),
  };
  const big = await ingestOne(
    streamed("http://x/api/ingest/w/o", 4096),
    params,
  );
  assert.equal(big.status, 413);
  const anon = await ingestOne(
    new Request("http://x/api/ingest/w/o", { method: "POST", body: "{nope" }),
    params,
  );
  assert.equal(anon.status, 401);
});

test("middleware: per-IP burst -> 429 + Retry-After; Content-Length > max -> 413", async () => {
  const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
  const req = (headers: Record<string, string> = {}) =>
    new NextRequest(`http://x/api/hooks/${crypto.randomUUID()}`, {
      method: "POST",
      headers: { "x-forwarded-for": `198.51.100.9, ${ip}`, ...headers },
    });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await middleware(req())).status);
  assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);
  const res = await middleware(req());
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) >= 1);
  // Other IP: not limited.
  const other = await middleware(
    new NextRequest("http://x/api/hooks/x", {
      method: "POST",
      headers: { "x-forwarded-for": "192.0.2.77" },
    }),
  );
  assert.equal(other.status, 200);
  const big = await middleware(
    new NextRequest("http://x/api/hooks/x", {
      method: "POST",
      headers: { "content-length": "4096", "x-forwarded-for": "192.0.2.78" },
    }),
  );
  assert.equal(big.status, 413);
});

test("clientIp: X-Forwarded-For read according to the number of trusted proxies", () => {
  const h = new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.2" });
  // One proxy (Caddy): its entry, on the right, is the client IP.
  assert.equal(clientIp(h, 1), "10.0.0.2");
  assert.equal(clientIp(h, 2), "1.2.3.4");
  // The entry forged by the client (on the left) is never used.
  assert.notEqual(clientIp(h, 1), "6.6.6.6");
  assert.equal(clientIp(new Headers(), 1), "unknown");
});
