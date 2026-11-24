// Docs E2E: home -> quickstart, then search.
// Requires playwright-core Chromium and a build (`pnpm build`). Starts
// `next start` on DOCS_E2E_PORT, unless DOCS_E2E_BASE_URL points to a server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { env, execPath } from "node:process";
import { setTimeout } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = Number(env.DOCS_E2E_PORT ?? 7399);
const base = env.DOCS_E2E_BASE_URL ?? `http://localhost:${port}`;
let server;
let browser;

/* global fetch, URL */
async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // server not started yet
    }
    await setTimeout(500);
  }
  throw new Error(`server not ready: ${url}`);
}

before(async () => {
  if (!env.DOCS_E2E_BASE_URL)
    server = spawn(
      execPath,
      ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
      { cwd: new URL("..", import.meta.url), stdio: "ignore" },
    );
  await waitFor(base);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test("home then quickstart", async () => {
  const page = await browser.newPage();
  await page.goto(base);
  await page.getByRole("heading", { name: "Runbase documentation" }).waitFor();
  await page.getByRole("link", { name: "Get started" }).click();
  await page.waitForURL(`${base}/docs/quickstart`);
  await page.getByRole("heading", { name: "1. Start an instance" }).waitFor();
  // After a client-side navigation, Next updates document.title asynchronously.
  await page.waitForFunction("/Quickstart/.test(document.title)");
  // Quickstart link to the generated reference.
  await page.getByRole("link", { name: "MCP reference" }).click();
  await page.waitForURL(`${base}/docs/reference/mcp`);
  await page.locator("h3#recordsupsert").waitFor();
});

test("search: returns matching pages", async () => {
  const res = await fetch(`${base}/docs/api/search?query=webhook`);
  assert.equal(res.status, 200);
  const hits = await res.json();
  assert.ok(hits.some((h) => h.url.startsWith("/docs/concepts/webhooks")));
});
