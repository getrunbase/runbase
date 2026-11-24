// E2E of import from the website: /templates/import?template=<id>
// first sends to /login (back via `next`), then imports the catalog
// template after confirmation. Same prerequisites as import-template.e2e.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import postgres from "postgres";
import { chromium, type Browser } from "playwright-core";

const port = Number(process.env.E2E_PORT ?? 7198);
const base = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
let server: ChildProcess | undefined;
let browser: Browser;

async function waitFor(url: string, ms = 180_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // server not started yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server not ready: ${url}`);
}

before(async () => {
  if (!process.env.E2E_BASE_URL)
    server = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "dev", "-p", String(port)],
      {
        env: { ...process.env, BETTER_AUTH_URL: base, SIGNUPS_ENABLED: "true" },
        stdio: "ignore",
        detached: true,
      },
    );
  await waitFor(`${base}/login`);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server?.pid) process.kill(-server.pid, "SIGTERM");
  await sql.end();
});

const target = "/templates/import?template=crm-light";

test("import from the website: sign-in first, then catalog import", async () => {
  // No session: redirect to /login with a return to the import page.
  // (loading.tsx: streaming render, the redirect happens on the client).
  const page = await browser.newPage({ locale: "en-US" });
  page.setDefaultTimeout(120_000);
  await page.goto(`${base}${target}`);
  await page.waitForURL(/\/login\?/);
  assert.equal(new URL(page.url()).searchParams.get("next"), target);

  // Magic link with the same return.
  const email = `e2e-${crypto.randomUUID()}@example.com`;
  const res = await fetch(`${base}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, callbackURL: target }),
  });
  assert.equal(res.status, 200, await res.text());
  const [row] = await sql<{ identifier: string }[]>`
    select identifier from verification
    where value like ${`%${email}%`} order by created_at desc limit 1`;
  const token = row!.identifier.replace(/^magic-link:/, "");

  await page.goto(
    `${base}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(target)}`,
  );
  await page.waitForURL(/\/templates\/import/);
  await page.getByText("Import “Light CRM”").waitFor();
  await page.getByRole("button", { name: "Import" }).click();
  await page.getByText("“Light CRM” imported").waitFor();

  // Unknown to the catalog: message, no import.
  await page.goto(`${base}/templates/import?template=nope`);
  await page.getByText("This template is not in the catalog.").waitFor();
});
