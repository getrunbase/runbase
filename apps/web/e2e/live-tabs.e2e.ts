// SDK live E2E: published TSX page that reads an object with
// useQuery, opened in two tabs. A creation via useMutation in
// tab A, then a write through the service, show up in tab B
// without reload (SSE /api/live, Redis bus).
//   pnpm --filter @runbase/web test:e2e
// Starts `next dev` on a free port (or E2E_BASE_URL, which must share
// DATABASE_URL, REDIS_URL and BETTER_AUTH_SECRET).
import { test, before, after } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import postgres from "postgres";
import type { Browser, Page } from "playwright-core";
import { objectsService } from "@runbase/core/objects";
import { pagesService } from "@runbase/core/pages";
import { recordsService } from "@runbase/core/records";
import type { TenantContext } from "@runbase/core/tenant";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
let base = process.env.E2E_BASE_URL ?? "";
let server: ChildProcess | undefined;
let browser: Browser;
let cookie: { name: string; value: string };
let ctx: TenantContext;
let objectId = "";
let pageId = "";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

async function startNext() {
  const port = await freePort();
  base = `http://localhost:${port}`;
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
      env: { ...process.env, BETTER_AUTH_URL: base, NODE_ENV: "development" },
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

// Account, workspace, Better Auth session, object and published TSX page.
async function seed() {
  const uid = randomUUID();
  const [org] =
    await sql`insert into organizations (name) values ('E2E live') returning id`;
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
    name: `${base.startsWith("https:") ? "__Secure-" : ""}better-auth.session_token`,
    value: encodeURIComponent(`${token}.${sig}`),
  };
  ctx = {
    organizationId: org!.id as string,
    workspaceId: ws!.id as string,
    actor: { userId: uid },
  };
  const o = await objectsService.create(ctx, {
    slug: "deals",
    name: "Deals",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  objectId = o.id;
  const page = await pagesService.create(ctx, {
    name: "Live",
    files: {
      "index.tsx": `import { useQuery, useMutation } from "@getrunbase/sdk";
export default function Live() {
  const q = useQuery({ object: ${JSON.stringify(o.id)} });
  const m = useMutation(${JSON.stringify(o.id)});
  return (
    <div>
      <p data-testid="count">count:{q.loading ? "…" : q.data.length}</p>
      <button onClick={() => m.create({ name: "from-tab" })}>add</button>
    </div>
  );
}`,
    },
    permissions: { objects: [o.id], write: [o.id] },
    publish: true,
  });
  pageId = page.id;
}

before(async () => {
  if (!base) await startNext();
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

async function open() {
  const context = await browser.newContext({ locale: "en-US" });
  await context.addCookies([{ ...cookie, url: base }]);
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  await page.goto(`${base}/p/${pageId}`);
  return page;
}

const count = (p: Page, n: number) =>
  p
    .frameLocator("iframe")
    .getByText(`count:${n}`, { exact: true })
    .waitFor({ timeout: 30_000 });

test("live: a write in one tab shows up in the other without reload", async () => {
  // Cold next dev: first compilation and Fast Refresh remount the page and
  // cut the first SSE streams. A warm-up tab absorbs this startup.
  const warm = await open();
  await count(warm, 0);
  await new Promise((r) => setTimeout(r, 5000));
  await warm.context().close();

  const a = await open();
  const b = await open();
  await Promise.all([count(a, 0), count(b, 0)]);
  // Lets B's SSE subscribe (ready) before writing.
  await new Promise((r) => setTimeout(r, 1500));
  let navB = 0;
  b.on("framenavigated", (f) => f === b.mainFrame() && navB++);

  // SDK write in tab A.
  await a.frameLocator("iframe").getByRole("button", { name: "add" }).click();
  await count(a, 1);
  await count(b, 1);

  // Write through the service (another user, workflow…).
  await recordsService.upsert(ctx, { objectId, data: { name: "server" } });
  await Promise.all([count(a, 2), count(b, 2)]);
  if (navB) throw new Error("l'onglet B a rechargé");
  await a.context().close();
  await b.context().close();
});
