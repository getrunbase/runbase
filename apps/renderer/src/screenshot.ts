// PNG captures (headless Chromium, playwright-core) for the renderer service: a
// code component rendered by the real iframe runtime (`componentScreenshot`)
// or an app page (`pageScreenshot`, optional axe audit). Shared browser
// launched on demand, global timeout; each capture has its own context.
// Parallelism is bounded by the BullMQ worker concurrency.
import type { Browser, BrowserContext, Page } from "playwright-core";
import axe from "axe-core";
import type {
  A11yViolation,
  Interaction,
  Shot,
  ShotReport,
  Theme,
  Viewport,
} from "@runbase/core/render";
import { env } from "@runbase/core/env";

const SIZES = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;
const TIMEOUT_MS = 15_000;
const MAX_HEIGHT = 4_000;
const RUNTIME_URL = "http://runtime.invalid/";

let browser: Promise<Browser> | undefined;
// Untrusted code: Chromium OS sandbox enabled (disabled by default
// by Playwright) and WebRTC without direct UDP (bypasses CSP and routing).
// As root, Chromium refuses its sandbox: --no-sandbox. Same with
// CHROMIUM_SANDBOX=false (hardened self-host container: no-new-privileges and
// seccomp block the setuid sandbox and user namespaces; the container,
// read_only with cap_drop ALL, is then the boundary).
// /dev/shm is tiny in a container: --disable-dev-shm-usage.
export function launchOptions(
  uid = process.getuid?.(),
  sandbox = env().CHROMIUM_SANDBOX,
) {
  const off = uid === 0 || !sandbox;
  return {
    chromiumSandbox: !off,
    args: [
      ...(off ? ["--no-sandbox"] : []),
      "--disable-dev-shm-usage",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  };
}
async function launch() {
  const { chromium } = await import("playwright-core");
  const path = env().PLAYWRIGHT_CHROMIUM_PATH;
  return chromium.launch({
    ...(path
      ? { executablePath: path }
      : { channel: "chromium-headless-shell" }),
    ...launchOptions(),
  });
}
function getBrowser() {
  browser ??= launch().then((b) => {
    b.on("disconnected", () => (browser = undefined));
    return b;
  });
  browser.catch(() => (browser = undefined));
  return browser;
}

// Browser available? (integration tests are skipped otherwise)
export async function browserAvailable() {
  try {
    await getBrowser();
    return true;
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, what: string) {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, ko) => {
      t = setTimeout(
        () => ko(new Error(`${what} took too long (max ${TIMEOUT_MS} ms)`)),
        TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(t));
}

async function newContext(viewport: Viewport, theme: Theme) {
  return (await getBrowser()).newContext({
    viewport: SIZES[viewport],
    deviceScaleFactor: 2,
    colorScheme: theme,
    serviceWorkers: "block",
  });
}

// Noise unrelated to rendering (service worker blocked during capture).
const NOISE = /serviceWorker|service worker/i;

function watch(page: Page, report: ShotReport) {
  page.on("console", (m) => {
    if (NOISE.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning")
      report.console.push(`${m.type()}: ${m.text()}`.slice(0, 500));
  });
  page.on("pageerror", (e) => {
    if (!NOISE.test(e.message)) report.errors.push(e.message.slice(0, 500));
  });
}

async function interact(page: Page, steps: Interaction[], report: ShotReport) {
  for (const s of steps)
    try {
      if ("click" in s) await page.click(s.click, { timeout: 3_000 });
      else if ("type" in s) await page.fill(s.type, s.text, { timeout: 3_000 });
      else if (typeof s.wait === "number")
        await page.waitForTimeout(Math.min(s.wait, 3_000));
      else await page.waitForSelector(s.wait, { timeout: 3_000 });
    } catch (e) {
      report.errors.push(
        `interaction ${JSON.stringify(s)} : ${(e as Error).message.split("\n")[0]}`,
      );
    }
  if (steps.length) await page.waitForTimeout(200);
}

const capture = (page: Page) =>
  page.screenshot({
    type: "png",
    fullPage: true,
    clip: undefined,
    animations: "disabled",
  });

// Height clipped to MAX_HEIGHT px.
async function clamp(page: Page, viewport: Viewport) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  if (h > MAX_HEIGHT)
    await page.setViewportSize({ ...SIZES[viewport], height: MAX_HEIGHT });
  return h > MAX_HEIGHT
    ? page.screenshot({ type: "png", animations: "disabled" })
    : capture(page);
}

// Emulates the iframe parent: the runtime page is loaded top-level
// (parent === window), runtime messages are relayed to Node.
// WebRTC removed before the bundle (no UDP connection to the internal network).
const HOST_SHIM = `for (const k of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) delete window[k];
addEventListener("message", async (e) => {
  const m = e.data;
  if (!m || typeof m !== "object" || e.source !== window) return;
  if (["ready", "call", "error", "idle"].includes(m.type)) {
    const r = await window.__host(m);
    if (r) postMessage(r, "*");
  }
});`;

export type ComponentShotInput = {
  // Iframe runtime page and its CSP (provided by the web app).
  html: string;
  csp: string;
  bundle: string;
  css: string;
  props: Record<string, unknown>;
  viewports: Viewport[];
  themes: Theme[];
  interactions?: Interaction[];
  // Response to an SDK call from the component (mock or real data).
  call: (method: unknown, args: unknown) => Promise<unknown>;
};

export async function componentScreenshot(
  input: ComponentShotInput,
): Promise<ShotReport & { sdkCalls: unknown[] }> {
  const report = { shots: [] as Shot[], errors: [], console: [] } as ShotReport;
  const sdkCalls: unknown[] = [];
  // Runtime served on a fake URL with its CSP (sandbox, connect-src
  // 'none'); any other request is refused.
  const { html } = input;
  const csp = input.csp.replace(/; frame-ancestors [^;]*/, "");
  for (const viewport of input.viewports)
    for (const theme of input.themes) {
      const ctx = await newContext(viewport, theme);
      try {
        await ctx.route("**", (r) =>
          r.request().url() === RUNTIME_URL
            ? r.fulfill({
                body: html,
                contentType: "text/html; charset=utf-8",
                headers: { "content-security-policy": csp },
              })
            : r.abort(),
        );
        const page = await ctx.newPage();
        watch(page, report);
        let idle!: () => void;
        const settled = new Promise<void>((r) => (idle = r));
        await page.exposeBinding("__host", async (_src, m: Msg) => {
          if (m.type === "ready")
            return {
              type: "init",
              bundle: input.bundle,
              css: input.css,
              props: input.props,
            };
          if (m.type === "error") report.errors.push(String(m.message));
          if (m.type === "idle" || m.type === "error") idle();
          if (m.type === "call") {
            sdkCalls.push({ method: m.method, args: m.args });
            try {
              return {
                type: "result",
                id: m.id,
                result: await input.call(m.method, m.args),
              };
            } catch (e) {
              return {
                type: "result",
                id: m.id,
                error: (e as Error).message,
              };
            }
          }
        });
        await page.addInitScript(HOST_SHIM);
        await withTimeout(
          (async () => {
            await page.goto(RUNTIME_URL);
            await settled;
            // Theme background (transparent in a page iframe).
            await page.evaluate(() => {
              document.body.style.background = "var(--background)";
            });
            await interact(page, input.interactions ?? [], report);
            report.shots.push({
              viewport,
              theme,
              png: await clamp(page, viewport),
            });
          })(),
          "capture",
        );
      } catch (e) {
        report.errors.push((e as Error).message);
      } finally {
        await ctx.close();
      }
    }
  // A given message is counted once (several viewports/themes).
  report.errors = [...new Set(report.errors)];
  report.console = [...new Set(report.console)];
  return { ...report, sdkCalls: sdkCalls.slice(0, 50) };
}

type Msg = Record<string, unknown>;

// Page rendered? No code block loading, no visible skeleton.
// Self-contained (serialized and evaluated in the browser).
export function pageSettled(doc: Document = document) {
  return (
    !doc.querySelector('[data-code-state="loading"]') &&
    !doc.querySelector('[data-slot="skeleton"]')
  );
}
// Code block errors shown in the page.
export function codeErrors(doc: Document = document) {
  return [...doc.querySelectorAll("[data-code-error]")].map(
    (e) =>
      `composant ${e.getAttribute("data-code-block")} : ${e.getAttribute("data-code-error")}`,
  );
}
const SETTLE_MS = 8_000;

// App page loaded from its local URL, authenticated by a short-lived token
// (header, read-only); only network traffic to the app origin is allowed.
export async function pageScreenshot(input: {
  url: string;
  token: string;
  viewport: Viewport;
  theme: Theme;
  audit?: boolean;
}): Promise<ShotReport> {
  const report: ShotReport = { shots: [], errors: [], console: [] };
  const origin = new URL(input.url).origin;
  let ctx: BrowserContext | undefined;
  try {
    ctx = await newContext(input.viewport, input.theme);
    await ctx.setExtraHTTPHeaders({ "x-screenshot-token": input.token });
    await ctx.route("**", (r) =>
      new URL(r.request().url()).origin === origin ||
      r.request().url().startsWith("data:")
        ? r.continue()
        : r.abort(),
    );
    const page = await ctx.newPage();
    watch(page, report);
    await withTimeout(
      (async () => {
        await page.goto(input.url, { waitUntil: "networkidle" });
        // Next dev indicator hidden.
        await page.addStyleTag({
          content: "nextjs-portal{display:none!important}",
        });
        // Code blocks ready (idle message) and loading finished, bounded.
        await page
          .waitForFunction(pageSettled, undefined, { timeout: SETTLE_MS })
          .catch(() =>
            report.errors.push(
              `rendering not finished after ${SETTLE_MS / 1000} s (code component or loading in progress)`,
            ),
          );
        report.errors.push(
          ...(await page.evaluate(codeErrors as () => string[])),
        );
        await page.waitForTimeout(300);
        if (input.audit) report.a11y = await audit(page);
        report.shots.push({
          viewport: input.viewport,
          theme: input.theme,
          png: await clamp(page, input.viewport),
        });
      })(),
      "capture",
    );
  } catch (e) {
    report.errors.push((e as Error).message);
  } finally {
    await ctx?.close();
  }
  return report;
}

// axe-core audit of the rendered page: WCAG 2.x A/AA violations. Injected through
// evaluate (CDP protocol), so independent of the page CSP.
async function audit(page: Page): Promise<A11yViolation[]> {
  await page.evaluate(axe.source);
  const r = await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      resultTypes: ["violations"],
    }),
  );
  return r.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? null,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
}
