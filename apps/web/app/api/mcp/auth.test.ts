// OAuth discovery: 401 with WWW-Authenticate and the
// protected-resource metadata, via route handlers called directly.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mcpResource } from "@runbase/core/auth";
import { POST } from "./route";
import { GET as wellKnown } from "../../.well-known/[...path]/route";

after(() => setImmediate(() => process.exit(0)));

const origin = new URL(mcpResource).origin;

test("POST /api/mcp without a token: 401 and resource_metadata", async () => {
  const res = await POST(
    new Request(`${origin}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );
  assert.equal(res.status, 401);
  const header = res.headers.get("www-authenticate") ?? "";
  const meta = header.match(/resource_metadata="?([^",\s]+)"?/)?.[1];
  assert.ok(meta, `WWW-Authenticate sans resource_metadata : ${header}`);
  assert.match(
    new URL(meta).pathname,
    /^\/\.well-known\/oauth-protected-resource/,
  );
});

test("GET /.well-known/oauth-protected-resource: resource and authorization_servers", async () => {
  const res = await wellKnown(
    new Request(`${origin}/.well-known/oauth-protected-resource/api/mcp`),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    resource?: string;
    authorization_servers?: string[];
  };
  assert.equal(body.resource, mcpResource);
  assert.ok(
    Array.isArray(body.authorization_servers) &&
      body.authorization_servers.length > 0,
  );
});
