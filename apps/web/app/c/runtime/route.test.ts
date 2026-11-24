// Code components runtime page: security headers, inline script and
// dedicated origin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "./route";

const get = (host: string) =>
  GET(new Request(`http://${host}/c/runtime`, { headers: { host } }));

test("runtime: CSP without network, enforced sandbox, inline runtime", async () => {
  delete process.env.NEXT_PUBLIC_RUNTIME_ORIGIN;
  const res = await get("localhost:7100");
  const csp = res.headers.get("content-security-policy")!;
  for (const d of [
    "sandbox allow-scripts",
    "default-src 'none'",
    "connect-src 'none'",
    "script-src 'unsafe-inline'",
    "frame-ancestors 'self'",
  ])
    assert.ok(csp.includes(d), d);
  assert.doesNotMatch(csp, /allow-same-origin|unsafe-eval/);
  const html = await res.text();
  assert.match(html, /<div id="root"><\/div><script>/);
  assert.equal(html.match(/<\/script/gi)!.length, 1, "un seul </script>");
});

test("runtime: dedicated origin, 404 on the app origin, framed by the app", async () => {
  process.env.NEXT_PUBLIC_RUNTIME_ORIGIN = "http://127.0.0.1:7100";
  process.env.BETTER_AUTH_URL = "http://localhost:7100";
  try {
    assert.equal((await get("localhost:7100")).status, 404);
    const res = await get("127.0.0.1:7100");
    assert.equal(res.status, 200);
    const csp = res.headers.get("content-security-policy")!;
    assert.match(csp, /frame-ancestors http:\/\/localhost:7100(;| |$)/);
    assert.doesNotMatch(csp, /frame-ancestors[^;]*'self'/);
    assert.ok(csp.includes("connect-src 'none'"));
  } finally {
    delete process.env.NEXT_PUBLIC_RUNTIME_ORIGIN;
  }
});
