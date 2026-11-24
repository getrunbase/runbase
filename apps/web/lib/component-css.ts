// Tailwind (v4) CSS for code components, compiled on the server with the
// app theme (@runbase/ui/theme.css: design system tokens). Candidates are extracted
// by the oxide scanner (the same as the app): arbitrary classes and variants
// included. `baseCss` (preflight, theme, @ui component classes) is
// built into the iframe runtime; `componentCss` only produces the
// utilities of the given sources (component + @components dependencies).
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const appDir = () => join(process.cwd(), "app");
// Components scanned for the base CSS: the app's (components/ui) and
// those of the @runbase/ui package they re-export.
const uiDirs = () => {
  const pkg = join(process.cwd(), "../../packages/ui");
  return [
    join(process.cwd(), "components/ui"),
    join(pkg, "components/ui"),
    join(pkg, "components/ds"),
  ];
};

// The iframe (web preview and renderer) has no next/font: we keep the
// design system families (Inter, IBM Plex Mono, see font-sans/font-mono tokens)
// before the system stack, like the app.
const IFRAME_ROOT =
  ':root{--font-inter:"Inter";--font-plex-mono:"IBM Plex Mono"}';

const ENTRY_BASE = `@import "tailwindcss";\n@import "tw-animate-css";\n@import "@runbase/ui/theme.css";`;
const ENTRY_UTILS = [
  "@layer theme, base, components, utilities;",
  '@import "tailwindcss/theme.css" layer(theme);',
  '@import "tailwindcss/utilities.css" layer(utilities);',
  '@import "tw-animate-css";',
  '@import "@runbase/ui/theme.css";',
].join("\n");

type Compiler = Awaited<ReturnType<typeof compile>>;
const compilers = new Map<string, Promise<Compiler>>();
function compiler(entry: string) {
  let c = compilers.get(entry);
  if (!c) {
    c = compile(entry, { base: appDir(), onDependency() {} });
    c.catch(() => compilers.delete(entry));
    compilers.set(entry, c);
  }
  return c;
}

export function candidates(sources: string[]): string[] {
  return new Scanner({}).scanFiles(
    sources.map((content) => ({ content, extension: "tsx" })),
  );
}

export async function componentCss(sources: string[]): Promise<string> {
  return (await compiler(ENTRY_UTILS)).build(candidates(sources));
}

let base: Promise<string> | undefined;
export function baseCss(): Promise<string> {
  base ??= (async () => {
    const files = (
      await Promise.all(
        uiDirs().map(async (dir) =>
          (await readdir(dir))
            .filter((f) => f.endsWith(".tsx"))
            .map((f) => join(dir, f)),
        ),
      )
    ).flat();
    const sources = await Promise.all(files.map((f) => readFile(f, "utf8")));
    const css = (await compiler(ENTRY_BASE)).build(candidates(sources));
    return `${css}\n${IFRAME_ROOT}`;
  })();
  base.catch(() => (base = undefined));
  return base;
}
