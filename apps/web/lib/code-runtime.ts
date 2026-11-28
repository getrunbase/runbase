// Code components runtime bundles (esbuild, cached per process):
// `runtimeScript` for the sandbox iframe, `chunkScript` for its lazy modules,
// `testHarness` for page.test.
import { build, type Plugin } from "esbuild";
import { join } from "node:path";
import { baseCss } from "./component-css";

const root = process.cwd();

// In a lazy chunk, React comes from the already loaded vendor (a single copy).
const shared: Plugin = {
  name: "shared",
  setup(b) {
    b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a) => ({
      path: a.path,
      namespace: "vendor",
    }));
    b.onLoad({ filter: /.*/, namespace: "vendor" }, (a) => ({
      contents: `module.exports = globalThis.__vendor[${JSON.stringify(a.path)}];`,
      loader: "js",
    }));
  },
};

// Browser target: server code must never reach a runtime bundle. Only the
// dependency-free mock of @getrunbase/core is allowed (page.test harness);
// any other core module (queues, database, bullmq...) is replaced by an empty
// module, and node:* builtins stay external instead of failing the build
// ("Could not resolve node:crypto").
export const CORE_BROWSER_SAFE = /^@getrunbase\/core\/components\/mock$/;
export const browserOnly: Plugin = {
  name: "browser-only",
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (a) => ({
      path: a.path,
      external: true,
    }));
    b.onResolve({ filter: /^@getrunbase\/core(\/.*)?$/ }, (a) =>
      CORE_BROWSER_SAFE.test(a.path)
        ? undefined
        : { path: a.path, namespace: "server-only" },
    );
    b.onLoad({ filter: /.*/, namespace: "server-only" }, () => ({
      contents: "module.exports = {};",
      loader: "js",
    }));
  },
};

async function bundle(entry: string, format: "iife" | "esm") {
  const r = await build({
    plugins: [browserOnly, ...(entry.startsWith("chunks/") ? [shared] : [])],
    // The harness runs under Deno (no document): non-DOM builds
    // (e.g. decode-named-character-reference from react-markdown).
    conditions: format === "esm" ? ["deno"] : [],
    entryPoints: [join(root, "components/code-runtime", entry)],
    // @getrunbase/kit only declares react, zod, recharts... as peers: a --prod
    // install leaves them out of packages/kit/node_modules, so resolve them
    // from the web app's dependencies.
    nodePaths: [join(root, "node_modules")],
    bundle: true,
    write: false,
    format,
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
    tsconfig: join(root, "tsconfig.json"),
    logLevel: "silent",
  });
  return r.outputFiles[0]!.text;
}

const cache = new Map<string, Promise<string>>();
function cached(entry: string, format: "iife" | "esm") {
  let p = cache.get(entry);
  if (!p) {
    p = bundle(entry, format);
    p.catch(() => cache.delete(entry));
    cache.set(entry, p);
  }
  return p;
}

export const runtimeScript = () => cached("runtime.tsx", "iife");
export const CHUNKS = ["tiptap", "maplibre"] as const;
export const isChunk = (id: string): id is (typeof CHUNKS)[number] =>
  (CHUNKS as readonly string[]).includes(id);
export const chunkScript = (id: (typeof CHUNKS)[number]) =>
  cached(`chunks/${id}.ts`, "iife");
export const testHarness = () => cached("harness.tsx", "esm");

// Runtime page headers: sandbox enforced even when opened outside an iframe,
// no fetch/XHR (connect-src 'none': the only channel is the postMessage
// bridge), no external images or CSS url(), inline scripts only.
// Runtime on a dedicated origin (NEXT_PUBLIC_RUNTIME_ORIGIN): only the app
// (and the renderer) can frame it; otherwise 'self'.
// Limitation: the sandbox does not stop the iframe from navigating itself
// (location.href); code-frame.tsx stops rendering on the second `load`, but
// the navigation request has already been sent.
export function runtimeCsp(ancestors: string[] = ["'self'"]) {
  return [
    "sandbox allow-scripts",
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${ancestors.join(" ")}`,
  ].join("; ");
}

// Base CSS (preflight, theme, @ui classes) built in: the iframe does not depend
// on the parent styles (and also renders alone, for captures).
export async function runtimeHtml() {
  const js = (await runtimeScript()).replace(/<\/script/gi, "<\\/script");
  const css = (await baseCss()).replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;background:transparent"><div id="root"></div><script>${js}</script></body></html>`;
}
