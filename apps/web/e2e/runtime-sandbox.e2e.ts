// E2E of the code components sandbox runtime: the app runs
// on localhost:<port>, the runtime on the dedicated origin 127.0.0.1:<port>
// (NEXT_PUBLIC_RUNTIME_ORIGIN). A TSX page is created then published, /p/<slug>
// mounts the `<runtime>/c/runtime` iframe with sandbox="allow-scripts" (without
// allow-same-origin), the component shows up, and a burst of SDK calls is
// refused with sdk.rateLimited. Finally, a page that throws an error
// on render makes it readable through the page.errors MCP tool (HTTP, API key) in
// under 5 s, located at file:line in the package.
//   pnpm --filter @runbase/web test:e2e
// NEXT_PUBLIC_RUNTIME_ORIGIN is frozen at build time: this test therefore starts its own
// `next dev` (E2E_BASE_URL not supported).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import postgres from "postgres";
import type { Browser } from "playwright-core";
import { apiKeysService } from "@runbase/core/api-keys";
import { objectsService } from "@runbase/core/objects";
import { pagesService } from "@runbase/core/pages";
import type { TenantContext } from "@runbase/core/tenant";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
let port = 0;
let base = "";
let runtime = "";
let server: ChildProcess | undefined;
let browser: Browser;
let cookie: { name: string; value: string };
let ctx: TenantContext;
let pageId = "";
let boomId = "";
let apiKey = "";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

async function startNext() {
  port = await freePort();
  base = `http://localhost:${port}`;
  runtime = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--turbopack",
      "-p",
      String(port),
    ],
    {
      env: {
        ...process.env,
        BETTER_AUTH_URL: base,
        NEXT_PUBLIC_RUNTIME_ORIGIN: runtime,
        NODE_ENV: "development",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  let out = "";
  server.stdout!.on("data", (d) => (out += d));
  server.stderr!.on("data", (d) => (out += d));
  for (let i = 0; i < 600; i++) {
    if (server.exitCode !== null) throw new Error(`next dev arrêté :\n${out}`);
    if (
      await fetch(`${base}/login`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`next dev non démarré :\n${out}`);
}

// Account, workspace, Better Auth session, object and TSX page (draft then
// publication) with a button that starts 8 SDK creations in parallel.
async function seed() {
  const uid = randomUUID();
  const [org] =
    await sql`insert into organizations (name) values ('E2E runtime') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  await sql`insert into "user" (id, name, email) values (${uid}, 'E2E', ${uid + "@e2e.test"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const token = randomUUID().replaceAll("-", "");
  await sql`insert into session (id, token, user_id, expires_at)
    values (${randomUUID()}, ${token}, ${uid}, now() + interval '1 hour')`;
  const sig = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(token)
    .digest("base64");
  cookie = {
    name: "better-auth.session_token",
    value: encodeURIComponent(`${token}.${sig}`),
  };
  ctx = {
    organizationId: org!.id as string,
    workspaceId: ws!.id as string,
    actor: { userId: uid },
  };
  const o = await objectsService.create(ctx, {
    slug: "notes",
    name: "Notes",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const page = await pagesService.create(ctx, {
    name: "Sandbox",
    files: {
      "index.tsx": `import { useState } from "react";
import { useMutation } from "@getrunbase/sdk";
export default function Sandbox() {
  const m = useMutation(${JSON.stringify(o.id)});
  const [errors, setErrors] = useState<string[]>([]);
  const burst = async () => {
    const r = await Promise.all(
      Array.from({ length: 8 }, (_, i) => m.create({ name: "n" + i })),
    );
    setErrors(r.flatMap((x) => (x.ok ? [] : [String(x.error)])));
  };
  return (
    <div>
      <h1>hello-sandbox</h1>
      <button onClick={burst}>burst</button>
      <ul data-testid="errors">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
    </div>
  );
}`,
    },
    permissions: { objects: [o.id], write: [o.id] },
  });
  await pagesService.publish(ctx, page.id);
  pageId = page.id;
  const boom = await pagesService.create(ctx, {
    name: "Boom",
    files: {
      "index.tsx": `import { Boom } from "./components/boom";
export default function Page() {
  return <Boom />;
}`,
      "components/boom.tsx": `export function Boom(): null {
  throw new Error("boom-e2e");
}`,
    },
    publish: true,
  });
  boomId = boom.id;
  apiKey = (
    await apiKeysService.create(ctx, {
      name: "e2e",
      scopes: ["read"],
      workspaceIds: [ctx.workspaceId],
    })
  ).key;
}

// MCP tool call over HTTP (JSON-RPC tools/call), JSON or SSE response.
async function mcp(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const msg = JSON.parse(line ? line.slice(5) : text);
  assert.ok(msg.result && !msg.result.isError, text);
  return JSON.parse(msg.result.content[0].text);
}

before(async () => {
  await startNext();
  await seed();
  const { chromium } = await import("playwright-core");
  browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : { channel: "chromium-headless-shell" },
  );
});

after(async () => {
  await browser?.close();
  if (server?.pid) process.kill(-server.pid);
  await sql.end();
  setImmediate(() => process.exit(0));
});

test("runtime sandbox: dedicated origin, strict sandbox, render and rate limit", async () => {
  // The runtime is only served on its dedicated origin.
  assert.equal((await fetch(`${base}/c/runtime`)).status, 404);
  const rt = await fetch(`${runtime}/c/runtime`);
  assert.equal(rt.status, 200);
  assert.match(
    rt.headers.get("content-security-policy") ?? "",
    new RegExp(`frame-ancestors [^;]*${base.replaceAll(".", "\\.")}`),
  );

  const context = await browser.newContext({ locale: "en-US" });
  await context.addCookies([{ ...cookie, url: base }]);
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  await page.goto(`${base}/p/${pageId}`);

  const iframe = page.locator(`[data-code-block="${pageId}"] iframe`);
  await iframe.waitFor();
  assert.equal(await iframe.getAttribute("src"), `${runtime}/c/runtime`);
  const sandbox = (await iframe.getAttribute("sandbox")) ?? "";
  assert.equal(sandbox, "allow-scripts");
  assert.doesNotMatch(sandbox, /allow-same-origin/);

  const frame = page.frameLocator(`[data-code-block="${pageId}"] iframe`);
  await frame.getByRole("heading", { name: "hello-sandbox" }).waitFor();
  // Opaque origin: the iframe document cannot read the parent's.
  const opaque = await page
    .frames()
    .find((f) => f.url().startsWith(runtime))!
    .evaluate(() => {
      try {
        return window.parent.document && "readable";
      } catch {
        return origin;
      }
    });
  assert.equal(opaque, "null");

  await frame.getByRole("button", { name: "burst" }).click();
  await frame
    .getByTestId("errors")
    .getByText("Too many SDK calls: at most 5 per second")
    .first()
    .waitFor({ timeout: 30_000 });
  await context.close();
});

test("runtime error: readable through MCP page.errors in under 5 s", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  await context.addCookies([{ ...cookie, url: base }]);
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  await page.goto(`${base}/p/${boomId}`);
  // Error shown by the parent: timer starts.
  await page
    .locator(`[data-code-block="${boomId}"][data-code-state="error"]`)
    .waitFor();
  const start = Date.now();
  let errors: { message: string; location?: string | null }[] = [];
  while (Date.now() - start < 5_000) {
    errors = await mcp("page.errors", { id: boomId });
    if (errors.some((e) => e.message.includes("boom-e2e"))) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const err = errors.find((e) => e.message.includes("boom-e2e"));
  assert.ok(err, `page.errors vide après 5 s : ${JSON.stringify(errors)}`);
  assert.match(String(err.location), /^components\/boom\.tsx:2:/);
  await context.close();
});
