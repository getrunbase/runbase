// Renderer integration (REDIS_URL + Chromium, skipped without a browser): the web
// app pushes a job via `render()` (core), this service's worker processes it, the
// PNG goes through the file driver and is deleted after reading.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import {
  memoryStorage,
  setFileStorage,
  type FileStorage,
} from "@getrunbase/core/files";
import { render, reviewPage } from "@getrunbase/core/render";
import { browserAvailable } from "./screenshot";
import { startRenderWorker } from "./worker";

// Keys stored (put) and deleted (remove) through the file driver.
const puts: string[] = [];
const removed: string[] = [];
let worker: ReturnType<typeof startRenderWorker>;
let server: Server;
let origin = "";
const ws = randomUUID();
const tokens: (string | undefined)[] = [];

before(async () => {
  const mem = memoryStorage();
  const storage: FileStorage = {
    ...mem,
    put: (k, f) => (puts.push(k), mem.put(k, f)),
    remove: (k) => (removed.push(k), mem.remove(k)),
  };
  setFileStorage(storage);
  worker = startRenderWorker(1);
  // Simulated app page: image without alt and html without lang (axe violations).
  server = createServer((req, res) => {
    tokens.push(req.headers["x-screenshot-token"] as string | undefined);
    res.writeHead(200, { "content-type": "text/html" });
    // Page with an unlabeled button (button-name violation).
    if (req.url?.startsWith("/p/button"))
      return res.end(
        `<!doctype html><html lang="en"><head><title>b</title></head><body><main><h1>B</h1><button></button></main></body></html>`,
      );
    res.end(
      `<!doctype html><html><head><title>t</title></head><body><h1>Pipeline</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></body></html>`,
    );
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await worker.close();
  setImmediate(() => process.exit(0));
});

const isPng = (b: Buffer) => b.subarray(0, 4).toString("hex") === "89504e47";

test("page job processed by the renderer: PNG, token forwarded, axe audit", async (t) => {
  if (!(await browserAvailable())) return t.skip("Chromium indisponible");
  const out = await render({
    kind: "page",
    workspaceId: ws,
    url: `${origin}/p/demo`,
    token: "tok-123",
    viewport: "mobile",
    theme: "light",
    audit: true,
  });
  assert.equal(out.shots.length, 1, JSON.stringify(out.errors));
  assert.ok(isPng(out.shots[0]!.png));
  assert.equal(out.shots[0]!.png.readUInt32BE(16), 390 * 2);
  assert.ok(tokens.includes("tok-123"));
  const ids = out.a11y!.map((v) => v.id);
  assert.ok(ids.includes("image-alt"), ids.join());
  assert.ok(ids.includes("html-has-lang"), ids.join());
  // PNG stored under the job workspace, read back then deleted.
  assert.equal(puts.length, 1);
  assert.match(
    puts[0]!,
    new RegExp(`^${ws}/renders/[^/]+/mobile-light\\.png$`),
  );
  assert.deepEqual(removed, puts);
});

// Minimal iframe runtime: same protocol as the real one (ready -> init,
// call -> result, idle).
const RUNTIME = `<!doctype html><html><body><div id="root"></div><script>
addEventListener("message", (e) => {
  const m = e.data, root = document.getElementById("root");
  if (m.type === "init") {
    root.textContent = "label:" + m.props.label;
    postMessage({ type: "call", id: 1, method: "query", args: { object: "o" } }, "*");
  }
  if (m.type === "result") {
    root.textContent += " rows:" + JSON.stringify(m.result).length;
    console.error("rendered");
    postMessage({ type: "idle" }, "*");
  }
});
postMessage({ type: "ready" }, "*");
</script></body></html>`;

test("component job: SDK calls served by the renderer (mock), one image per viewport", async (t) => {
  if (!(await browserAvailable())) return t.skip("Chromium indisponible");
  const out = await render({
    kind: "component",
    ctx: {
      organizationId: randomUUID(),
      workspaceId: ws,
      actor: { userId: "u" },
    },
    html: RUNTIME,
    csp: "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'self'",
    bundle: "",
    css: "",
    props: { label: "x" },
    viewports: ["desktop", "mobile"],
    themes: ["light"],
    data: { mode: "mock", data: { o: [{ id: "1" }, { id: "2" }] } },
  });
  assert.equal(out.shots.length, 2, JSON.stringify(out.errors));
  assert.ok(out.shots.every((s) => isPng(s.png) && s.theme === "light"));
  assert.deepEqual(out.sdkCalls![0], {
    method: "query",
    args: { object: "o" },
  });
  assert.ok(out.console.some((c) => c.includes("rendered")));
  assert.deepEqual(out.errors, []);
});

// page.update review = desktop + mobile captures and axe audit.
test("reviewPage: unlabeled button, button-name violation and two captures", async (t) => {
  if (!(await browserAvailable())) return t.skip("Chromium indisponible");
  const r = await reviewPage({
    kind: "page",
    workspaceId: ws,
    url: `${origin}/p/button`,
    token: "tok",
    theme: "light",
  });
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.shots.map((s) => s.viewport),
    ["desktop", "mobile"],
  );
  const ids = r.a11y.map((v) => v.id);
  assert.ok(ids.includes("button-name"), ids.join());
});

test("reviewPage: timeout exceeded, warning without exception", async () => {
  const start = Date.now();
  const r = await reviewPage(
    {
      kind: "page",
      workspaceId: ws,
      url: `${origin}/p/button`,
      token: "tok",
      theme: "light",
    },
    1,
  );
  assert.ok(Date.now() - start < 2_000);
  assert.deepEqual(r.shots, []);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0]!, /timed out/);
});
