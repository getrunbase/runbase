// Compilation of a code component (TSX) when saving: IIFE bundle
// (`__C.default` = component). Allowed imports: vendor modules read from
// `globalThis.__vendor`, provided by the runtime (react, @getrunbase/sdk, @getrunbase/kit, @ui/<name>,
// recharts, date-fns, headless libs from ALLOWED), bundled lucide-react (only the icons used) and
// @components/<name> (another workspace component, compiled into the bundle).
// Any other import (relative, package, http) is refused. Size (dependencies
// included) and duration capped.
//
// Page package (compilePackage): in addition, relative imports (`./x`,
// `../lib/y`, optional .ts/.tsx extension, folder `index.tsx`) resolved
// from the `files` map (no FS), per-package caps and external sourcemap
// to map compile and runtime errors back to file:line:column.
import { SourceMap } from "node:module";
import { posix } from "node:path";
import { build, type Message, type Plugin } from "esbuild";
import { appError } from "../errors/app-error";

export const MAX_SOURCE = 100_000;
export const MAX_BUNDLE = 300_000;
const TIMEOUT_MS = 5_000;
// Per-package caps.
export const MAX_PACKAGE_SOURCE = 500_000;
export const MAX_PACKAGE_FILES = 100;
export const MAX_PACKAGE_BUNDLE = 1_000_000;

export type CompileError = {
  file?: string;
  line?: number;
  col?: number;
  text: string;
};
export type ComponentDep = { name: string; version: number };
export type CompileResult =
  | { bundle: string; errors: []; deps: ComponentDep[]; sources: string[] }
  | { bundle?: undefined; errors: CompileError[] };

// `@components/<name>[@<version>]`: another workspace component, compiled into
// the same bundle. Without version: the latest (pinned in `deps`).
export type ComponentResolver = (
  name: string,
  version?: number,
) => Promise<{ source: string; version: number } | null>;

const MAX_DEPTH = 5;
const ALLOWED =
  /^(react|react\/jsx-runtime|react-dom|@getrunbase\/sdk|@getrunbase\/kit|@ui\/[a-z-]+|lucide-react|recharts|date-fns|@dnd-kit\/(core|sortable|utilities)|@tanstack\/react-(table|virtual)|react-hook-form|zod|motion|motion\/react|@xyflow\/react|react-markdown|react-day-picker|@tiptap\/(react|starter-kit)|maplibre-gl)$/;
const COMPONENT = /^@components\/([a-z0-9_.-]+?)(?:@(\d+))?$/;
const PERMIS =
  "react, react-dom, @getrunbase/sdk, @getrunbase/kit, @ui/<component>, @components/<name>[@version], lucide-react, recharts, date-fns, @dnd-kit/{core,sortable,utilities}, @tanstack/react-{table,virtual}, react-hook-form, zod, motion[/react], @xyflow/react, react-markdown, react-day-picker, @tiptap/{react,starter-kit} (lazy), maplibre-gl (lazy)";
// lucide-react is a runtime dependency of @getrunbase/core even though no core
// module imports it: esbuild resolves it from here to bundle the icons used by
// user components. Do not remove it from package.json.
// Folders where lucide-react is resolved (bundled, tree-shaking): the package one
// then the cwd (once bundled by Next, import.meta.dirname is undefined or
// points into .next).
const HERE = import.meta.dirname as string | undefined;
export const resolveDirs = () =>
  [HERE, process.cwd()].filter((d): d is string => !!d);

type Chain = { chain: string[] };

// Resolves `spec` relative to `from` in the package map.
function resolveRelative(
  files: Record<string, string>,
  from: string,
  spec: string,
) {
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  return [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
  ].find((p) => !p.startsWith("..") && p in files);
}

function plugin(
  resolve: ComponentResolver | undefined,
  deps: Map<string, ComponentDep & { source: string }>,
  dirs: string[],
  files?: Record<string, string>,
): Plugin {
  return {
    name: "imports",
    setup(b) {
      b.onResolve({ filter: /.*/ }, async (a) => {
        if (files && a.kind === "entry-point")
          return { path: a.path, namespace: "pkg" };
        if (files && a.namespace === "pkg" && /^\.\.?(\/|$)/.test(a.path)) {
          const path = resolveRelative(files, a.importer, a.path);
          return path
            ? { path, namespace: "pkg" }
            : { errors: [{ text: `file not found: ${a.path}` }] };
        }
        if (a.kind === "entry-point" || (a.pluginData as { real?: true })?.real)
          return undefined;
        // lucide-react internal files: normal resolution, React vendor.
        if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(a.importer))
          return a.path === "react" || a.path.startsWith("react/")
            ? { path: a.path, namespace: "vendor" }
            : undefined;
        if (a.path === "lucide-react") {
          for (const resolveDir of dirs) {
            const r = await b.resolve("lucide-react", {
              kind: a.kind,
              resolveDir,
              pluginData: { real: true },
            });
            if (!r.errors.length) return { path: r.path };
          }
          return { errors: [{ text: `lucide-react not found (${dirs})` }] };
        }
        const m = COMPONENT.exec(a.path);
        if (m) {
          const chain = (a.pluginData as Chain | undefined)?.chain ?? [];
          const name = m[1]!;
          if (chain.includes(name))
            return {
              errors: [
                {
                  text: `circular import: ${[...chain, name].join(" -> ")}`,
                },
              ],
            };
          if (chain.length >= MAX_DEPTH)
            return {
              errors: [
                {
                  text: `@components imports too deep (max ${MAX_DEPTH})`,
                },
              ],
            };
          if (!resolve)
            return {
              errors: [{ text: `@components not available here: ${a.path}` }],
            };
          const want = m[2] ? Number(m[2]) : undefined;
          const known = deps.get(name);
          if (known && want !== undefined && known.version !== want)
            return {
              errors: [
                {
                  text: `@components/${name} imported in two versions (${known.version}, ${want})`,
                },
              ],
            };
          const dep = known ?? (await resolve(name, want));
          if (!dep)
            return {
              errors: [
                {
                  text: `unknown component: @components/${name}${want ? `@${want}` : ""}`,
                },
              ],
            };
          deps.set(name, { name, version: dep.version, source: dep.source });
          return {
            path: name,
            namespace: "components",
            pluginData: { chain: [...chain, name] },
          };
        }
        if (!ALLOWED.test(a.path))
          return {
            errors: [
              { text: `forbidden import: ${a.path} (allowed: ${PERMIS})` },
            ],
          };
        return { path: a.path, namespace: "vendor" };
      });
      b.onLoad({ filter: /.*/, namespace: "pkg" }, (a) => ({
        contents: files![a.path]!,
        loader: a.path.endsWith(".ts") ? "ts" : "tsx",
      }));
      b.onLoad({ filter: /.*/, namespace: "components" }, (a) => ({
        contents: deps.get(a.path)!.source,
        loader: "tsx",
        pluginData: a.pluginData,
      }));
      b.onLoad({ filter: /.*/, namespace: "vendor" }, (a) => ({
        contents: `module.exports = globalThis.__vendor[${JSON.stringify(a.path)}];`,
        loader: "js",
      }));
    },
  };
}

// Internal paths (absolute, node_modules) are server details the author can
// not act on: keep the package-relative part only.
const NODE_MODULES =
  /(?:[^\s"'`()]*[\\/])?node_modules[\\/](?:\.pnpm[\\/][^\\/\s]+[\\/]node_modules[\\/])?/g;
export const stripInternalPaths = (s: string) => s.replace(NODE_MODULES, "");

const toError = (m: Message): CompileError => ({
  ...(m.location?.file
    ? { file: stripInternalPaths(m.location.file.replace(/^pkg:/, "")) }
    : {}),
  line: m.location?.line,
  col: m.location?.column,
  text: stripInternalPaths(m.text),
});

// "file:line:col text" (or the bare text without location), for agents.
export const formatCompileError = (e: CompileError) =>
  e.line
    ? `${e.file ? `${e.file}:` : ""}${e.line}:${e.col ?? 0} ${e.text}`
    : e.text;

export async function compileComponent(
  source: string,
  opts: { resolve?: ComponentResolver; dirs?: string[] } = {},
): Promise<CompileResult> {
  if (Buffer.byteLength(source) > MAX_SOURCE)
    return {
      errors: [{ text: `source too large (max ${MAX_SOURCE} bytes)` }],
    };
  let timer: NodeJS.Timeout | undefined;
  const deps = new Map<string, ComponentDep & { source: string }>();
  try {
    const r = await Promise.race([
      build({
        stdin: {
          contents: source,
          loader: "tsx",
          sourcefile: "component.tsx",
        },
        bundle: true,
        write: false,
        format: "iife",
        globalName: "__C",
        jsx: "automatic",
        platform: "browser",
        target: "es2022",
        minify: true,
        keepNames: true, // component names in React stacks
        legalComments: "none",
        logLevel: "silent",
        plugins: [plugin(opts.resolve, deps, opts.dirs ?? resolveDirs())],
      }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(
          () =>
            rej(
              appError(
                "pages.compileTimeout",
                "compilation too long (max {max} ms)",
                { max: TIMEOUT_MS },
              ),
            ),
          TIMEOUT_MS,
        );
      }),
    ]);
    const bundle = r.outputFiles[0]!.text;
    if (Buffer.byteLength(bundle) > MAX_BUNDLE)
      return {
        errors: [{ text: `bundle too large (max ${MAX_BUNDLE} bytes)` }],
      };
    // No default export: library component (imported through @components).
    if (!/\bexport\b/.test(source))
      return {
        errors: [
          {
            text: "missing export: export default the component (or named exports for an @components library)",
          },
        ],
      };
    const list = [...deps.values()];
    return {
      bundle,
      errors: [],
      deps: list.map(({ name, version }) => ({ name, version })),
      sources: [source, ...list.map((d) => d.source)],
    };
  } catch (e) {
    const errs = (e as { errors?: Message[] }).errors;
    return {
      errors: errs?.length
        ? errs.map(toError)
        : [{ text: (e as Error).message }],
    };
  } finally {
    clearTimeout(timer);
  }
}

export type PackageResult =
  | { bundle: string; map: string; errors: [] }
  | { bundle?: undefined; map?: undefined; errors: CompileError[] };

// Compiles a package (path -> source map) from `entry`. `map` = v3 sourcemap
// of the bundle (sources = package paths), see originalPosition.
export async function compilePackage(
  files: Record<string, string>,
  entry = "index.tsx",
  opts: { dirs?: string[] } = {},
): Promise<PackageResult> {
  const paths = Object.keys(files);
  if (paths.length > MAX_PACKAGE_FILES)
    return { errors: [{ text: `too many files (max ${MAX_PACKAGE_FILES})` }] };
  const size = paths.reduce((n, p) => n + Buffer.byteLength(files[p]!), 0);
  if (size > MAX_PACKAGE_SOURCE)
    return {
      errors: [{ text: `package too large (max ${MAX_PACKAGE_SOURCE} bytes)` }],
    };
  if (!(entry in files))
    return { errors: [{ file: entry, text: `entry not found: ${entry}` }] };
  let timer: NodeJS.Timeout | undefined;
  try {
    const r = await Promise.race([
      build({
        entryPoints: [entry],
        outfile: "bundle.js",
        sourcemap: "external",
        bundle: true,
        write: false,
        format: "iife",
        globalName: "__C",
        jsx: "automatic",
        platform: "browser",
        target: "es2022",
        minify: true,
        keepNames: true, // component names in React stacks
        legalComments: "none",
        logLevel: "silent",
        plugins: [
          plugin(undefined, new Map(), opts.dirs ?? resolveDirs(), files),
        ],
      }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(
          () =>
            rej(
              appError(
                "pages.compileTimeout",
                "compilation too long (max {max} ms)",
                { max: TIMEOUT_MS },
              ),
            ),
          TIMEOUT_MS,
        );
      }),
    ]);
    const out = (ext: string) =>
      r.outputFiles.find((f) => f.path.endsWith(ext))!.text;
    const bundle = out(".js");
    if (Buffer.byteLength(bundle) > MAX_PACKAGE_BUNDLE)
      return {
        errors: [
          { text: `bundle too large (max ${MAX_PACKAGE_BUNDLE} bytes)` },
        ],
      };
    if (!/\bexport\s+default\b/.test(files[entry]!))
      return {
        errors: [
          {
            file: entry,
            text: "missing export: export default the page component",
          },
        ],
      };
    const map = JSON.parse(out(".map")) as { sources: string[] };
    map.sources = map.sources.map((s) => s.replace(/^pkg:/, ""));
    return { bundle, map: JSON.stringify(map), errors: [] };
  } catch (e) {
    const errs = (e as { errors?: Message[] }).errors;
    return {
      errors: errs?.length
        ? errs.map(toError)
        : [{ text: (e as Error).message }],
    };
  } finally {
    clearTimeout(timer);
  }
}

// Position (1-based) in the bundle -> file:line:column of the package.
export function originalPosition(map: string, line: number, col: number) {
  const o = new SourceMap(JSON.parse(map)).findOrigin(line, col);
  return "fileName" in o
    ? { file: o.fileName, line: o.lineNumber, col: o.columnNumber }
    : undefined;
}

// Displayable error for a package that does not compile (first error).
export function packageCompileError(errors: CompileError[]) {
  const e = errors[0] ?? { text: "unknown error" };
  return appError(
    "pages.compileFailed",
    "Compilation failed at {file}:{line}:{col}: {text}",
    { file: e.file ?? "-", line: e.line ?? 0, col: e.col ?? 0, text: e.text },
  );
}
