// E2E segment boundaries on /runs/[id]: not found (uuid and
// non-uuid), server error (local boundary + retry), local loading.
// In every case the layout sidebar and header stay visible.
//   pnpm --filter @runbase/web test:e2e
// Starts `next dev` on a free port (or uses E2E_BASE_URL, which must
// share DATABASE_URL and BETTER_AUTH_SECRET). A dedicated test database
// is recommended: the test briefly renames the function_logs table.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import postgres from "postgres";
import type { Browser, Page } from "playwright-core";
import { functionsService } from "@runbase/core/functions";
import { runsService } from "@runbase/core/runs";
import { workflowsService } from "@runbase/core/workflows";
import en from "../messages/en/common.json";
import enHome from "../messages/en/home.json";
import enRuns from "../messages/en/runs.json";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
let base = process.env.E2E_BASE_URL ?? "";
let server: ChildProcess | undefined;
let browser: Browser;
let cookie: { name: string; value: string };
let runId = "";

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
      // Dedicated process group: stops next and its workers.
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

// Account, organization, workspace, Better Auth session (cookie signed
// HMAC-SHA256 with BETTER_AUTH_SECRET) and a test run.
async function seed() {
  const uid = randomUUID();
  const [org] =
    await sql`insert into organizations (name) values ('E2E boundaries') returning id`;
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
  const secure = base.startsWith("https:") ? "__Secure-" : "";
  cookie = {
    name: `${secure}better-auth.session_token`,
    value: encodeURIComponent(`${token}.${sig}`),
  };
  const ctx = {
    organizationId: org!.id as string,
    workspaceId: ws!.id as string,
    actor: { userId: uid },
  };
  await functionsService.save(ctx, {
    name: "noop",
    code: "export default () => ({})",
  });
  const wf = await workflowsService.create(ctx, {
    name: "Boundaries",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [{ id: "s", type: "fn.noop", input: {} }],
      next: {},
    },
  });
  runId = (await runsService.start(ctx, wf.id, { test: true }))!.id;
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

async function open(path: string) {
  const context = await browser.newContext({ locale: "en-US" });
  await context.addCookies([{ ...cookie, url: base }]);
  const page = await context.newPage();
  // First next dev compilation: up to 2 min.
  page.setDefaultTimeout(120_000);
  await page.goto(base + path);
  return page;
}

async function assertLayout(page: Page) {
  assert.ok(await page.locator('[data-sidebar="sidebar"]').first().isVisible());
  assert.ok(await page.locator("header").first().isVisible());
}

test("missing id (uuid): page not found inside the layout", async () => {
  const page = await open(`/runs/${randomUUID()}`);
  await page.getByText(enHome.notFound.title).waitFor();
  await assertLayout(page);
  await page.context().close();
});

test("non-uuid id: page not found inside the layout", async () => {
  const page = await open("/runs/not-a-uuid");
  await page.getByText(enHome.notFound.title).waitFor();
  await assertLayout(page);
  await page.context().close();
});

test("server error: local boundary, layout kept, retry", async () => {
  // Real failure of the run query (logs table unavailable); the
  // layout (sidebar, nav) does not depend on it.
  await sql`alter table function_logs rename to function_logs_e2e_off`;
  let page: Page | undefined;
  try {
    page = await open(`/runs/${runId}`);
    const boundary = page.locator("[data-segment-error]");
    await boundary.waitFor();
    assert.ok((await boundary.innerText()).includes(enRuns.boundary.error));
    await assertLayout(page);
    assert.ok(
      await boundary.getByRole("button", { name: en.retry }).isVisible(),
    );
  } finally {
    await sql`alter table function_logs_e2e_off rename to function_logs`;
  }
  // Failure lifted: retry renders the run without reloading the page.
  await page.locator("[data-segment-error]").getByRole("button").click();
  await page
    .getByRole("heading", {
      name: enRuns.detail.title.replace("{id}", runId.slice(0, 8)),
    })
    .waitFor();
  assert.equal(await page.locator("[data-segment-error]").count(), 0);
  await page.context().close();
});

test("local loading: skeleton inside the layout during navigation", async () => {
  const page = await open("/runs");
  // Slowed route: the run RSC request waits 2 s.
  await page.route(`**/runs/${runId}**`, async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await page.locator(`a[href="/runs/${runId}"]`).click();
  const loading = page.locator("[data-segment-loading]");
  await loading.waitFor();
  assert.equal(
    await loading.getAttribute("aria-label"),
    enRuns.boundary.loading,
  );
  await assertLayout(page);
  await page
    .getByRole("heading", {
      name: enRuns.detail.title.replace("{id}", runId.slice(0, 8)),
    })
    .waitFor();
  await page.context().close();
});
