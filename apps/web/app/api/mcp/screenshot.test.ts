// E2E page.screenshot: the MCP tool pushes a `render` job, the
// renderer service (separate process, as in production) handles it in
// Chromium, stores the PNG through the shared file driver (local, temporary
// folder) and the MCP returns the image. The app seen by the renderer is a
// local HTTP server that checks the capture token. Requires DATABASE_URL,
// REDIS_URL and Chromium (skipped otherwise).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localStorage, setFileStorage } from "@getrunbase/core/files";
import { rendererHealth } from "@getrunbase/core/render";
import { SHOT_HEADER, verifyShotToken } from "@/lib/screenshot-token";
import { client, owner, raw } from "./test-client";

const rendererDir = fileURLToPath(
  new URL("../../../../renderer", import.meta.url),
);
const tsx = ["--env-file-if-exists=../../.env", "--import", "tsx"];
// The web test tsconfig (@/ alias) does not apply to the renderer.
const baseEnv = { ...process.env };
delete baseEnv.TSX_TSCONFIG_PATH;

// Chromium reachable from the renderer (system binary or Playwright).
const browser =
  spawnSync(
    process.execPath,
    [
      ...tsx,
      "-e",
      "import('./src/screenshot.ts').then(m => m.browserAvailable()).then(ok => process.exit(ok ? 0 : 1))",
    ],
    { cwd: rendererDir, env: baseEnv, timeout: 60_000 },
  ).status === 0;

let renderer: ChildProcess | undefined;
let app: Server | undefined;
let filesDir = "";
const seen: { path: string; page?: string }[] = [];

before(async () => {
  if (!browser) return;
  filesDir = await mkdtemp(join(tmpdir(), "shot-e2e-"));
  setFileStorage(localStorage(filesDir));
  app = createServer((req, res) => {
    const claims = verifyShotToken(req.headers[SHOT_HEADER] as string);
    seen.push({ path: req.url ?? "", page: claims?.page });
    if (!claims) return void res.writeHead(401).end();
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      `<!doctype html><html lang="en"><head><title>Leads</title></head><body><main><h1>Leads</h1></main></body></html>`,
    );
  }).listen(0, "127.0.0.1");
  await new Promise((r) => app!.once("listening", r));
  process.env.RENDERER_APP_URL = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  renderer = spawn(process.execPath, [...tsx, "src/index.ts"], {
    cwd: rendererDir,
    env: {
      ...baseEnv,
      RENDERER_APP_URL: process.env.RENDERER_APP_URL,
      FILES_DRIVER: "local",
      FILES_DIR: filesDir,
      RENDERER_HEALTH_PORT: String(20_000 + Math.floor(Math.random() * 20_000)),
      RENDER_CONCURRENCY: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  // page.screenshot reports the renderer as down until its worker listens.
  if (browser)
    for (let i = 0; i < 300 && !(await rendererHealth()).available; i++)
      await new Promise((r) => setTimeout(r, 100));
});

after(() => {
  renderer?.kill("SIGTERM");
  app?.close();
  setImmediate(() => process.exit(0));
});

test(
  "page.screenshot via MCP: job handled by the renderer, PNG returned",
  { skip: !browser && "Chromium unavailable" },
  async () => {
    const ctx = await owner();
    const page = await client(ctx)("page.create", {
      name: "Leads",
      files: { "index.tsx": "export default () => <p>Leads</p>;" },
      publish: true,
    });
    const res = (await raw(ctx)("page.screenshot", {
      id: page.id,
      audit: true,
    })) as unknown as {
      isError?: boolean;
      content: {
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }[];
    };
    assert.ok(!res.isError, JSON.stringify(res.content).slice(0, 500));
    const img = res.content.find((c) => c.type === "image");
    assert.equal(img?.mimeType, "image/png");
    const png = Buffer.from(img!.data!, "base64");
    // Signature PNG.
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.ok(png.length > 1000);
    const rest = JSON.parse(res.content.at(-1)!.text!);
    assert.deepEqual(rest.errors, []);
    assert.ok(Array.isArray(rest.a11y));
    // The renderer loaded the page with a valid token for this page.
    assert.ok(
      seen.some(
        (s) => s.path.startsWith(`/p/${page.id}`) && s.page === page.id,
      ),
    );
    // The transient PNG is deleted after the web reads it.
    assert.deepEqual(
      await readdir(join(filesDir, ctx.workspaceId, "renders"))
        .then((d) =>
          Promise.all(
            d.map((j) =>
              readdir(join(filesDir, ctx.workspaceId, "renders", j)),
            ),
          ),
        )
        .then((l) => l.flat()),
      [],
    );
  },
);
