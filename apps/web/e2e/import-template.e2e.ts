// E2E of template import in the UI: Databases page, "Import
// template" dialog, success (EN) then translated zod error (FR).
// Requires DATABASE_URL (migrated) and playwright-core Chromium. Starts
// `next dev` on E2E_PORT, unless E2E_BASE_URL points to a running server
// (then started with SIGNUPS_ENABLED=true and BETTER_AUTH_URL = that URL).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import postgres from "postgres";
import { chromium, type Browser } from "playwright-core";

const port = Number(process.env.E2E_PORT ?? 7199);
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
  if (!process.env.E2E_BASE_URL) {
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "-p",
        String(port),
      ],
      {
        env: {
          ...process.env,
          BETTER_AUTH_URL: base,
          SIGNUPS_ENABLED: "true",
        },
        stdio: "ignore",
        detached: true,
      },
    );
  }
  await waitFor(`${base}/login`);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server?.pid) process.kill(-server.pid, "SIGTERM");
  await sql.end();
});

// Magic link sign-in: the token is read from the verification table.
async function signIn(email: string) {
  const res = await fetch(`${base}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, callbackURL: "/databases" }),
  });
  assert.equal(res.status, 200, await res.text());
  const [row] = await sql<{ identifier: string }[]>`
    select identifier from verification
    where value like ${`%${email}%`} order by created_at desc limit 1`;
  // Better Auth prefixes the identifier: `magic-link:<token>`.
  const token = row!.identifier.replace(/^magic-link:/, "");
  return `${base}/api/auth/magic-link/verify?token=${token}&callbackURL=/databases`;
}

const valid = {
  format: "runbase-template",
  version: 1,
  name: "E2E CRM",
  databases: [{ slug: "crm", name: "CRM" }],
  objects: [
    {
      slug: "lead",
      name: "Lead",
      database: "crm",
      fields: [{ key: "email", label: "Email", type: "text" }],
    },
  ],
  secrets: ["CRM_TOKEN"],
};
const invalid = { ...valid, version: 2 };

test("template import: success then error translated to FR", async () => {
  const email = `e2e-${crypto.randomUUID()}@example.com`;
  const page = await browser.newPage({ locale: "en-US" });
  // First `next dev` compilation: pages are slow on first visit.
  page.setDefaultTimeout(120_000);
  await page.goto(await signIn(email));
  await page.waitForURL(/\/databases/);

  const submit = async (json: unknown) => {
    await page
      .getByLabel(/Template content|Contenu du modèle/)
      .fill(JSON.stringify(json));
    await page.getByRole("button", { name: /^(Import|Importer)$/ }).click();
  };

  await page.getByRole("button", { name: "Import a template" }).click();
  await submit(valid);
  const ok = page.getByRole("alert");
  await ok.getByText("“E2E CRM” imported: 1 table").waitFor();
  await ok
    .getByText("Credentials to add before turning on workflows: CRM_TOKEN")
    .waitFor();

  await page
    .context()
    .addCookies([{ name: "NEXT_LOCALE", value: "fr", url: base }]);
  await page.reload();
  await page.getByRole("button", { name: "Importer un modèle" }).click();
  await submit(invalid);
  const err = page.getByRole("alert");
  await err.getByText("Échec de l'import").waitFor();
  const text = await err.innerText();
  assert.match(text, /Template invalide \(1 erreur\(s\)\)/);
  assert.match(text, /version :/);
});
