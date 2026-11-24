// Host tools (Node): reading a connector, bundling for the sandbox
// (a single ESM module, dependencies included), static JSON registry.
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { nodesOf, type Node, type NodeManifest } from "./index.ts";

export const SCOPE = "@runbase-connectors/";
// Maximum bundled code size (dependencies included).
export const MAX_BUNDLE = 2_000_000;

export type ConnectorInfo = {
  name: string;
  version: string;
  label: string;
  description: string;
  dir: string;
  entry: string;
};

type Pkg = {
  name?: string;
  version?: string;
  description?: string;
  runbase?: { entry?: string; label?: string };
};

// Connector = folder whose package.json has a `runbase` field.
export async function readConnector(
  dir: string,
): Promise<ConnectorInfo | null> {
  let pkg: Pkg;
  try {
    pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as Pkg;
  } catch {
    return null;
  }
  if (!pkg.runbase || !pkg.name) return null;
  const abs = resolve(dir);
  return {
    name: pkg.name,
    version: pkg.version ?? "0.0.0",
    label: pkg.runbase.label ?? pkg.name.replace(SCOPE, ""),
    description: pkg.description ?? "",
    dir: abs,
    entry: join(abs, pkg.runbase.entry ?? "index.ts"),
  };
}

// Connector subfolders of a root folder (connectors/, node_modules/@runbase-connectors/).
export async function listConnectors(root: string): Promise<ConnectorInfo[]> {
  let names: string[];
  try {
    names = (await readdir(root)).sort();
  } catch {
    return [];
  }
  const out: ConnectorInfo[] = [];
  for (const n of names) {
    if (n.startsWith(".")) continue;
    const dir = join(root, n);
    if (!(await stat(dir).catch(() => null))?.isDirectory()) continue;
    const c = await readConnector(dir);
    if (c) out.push(c);
  }
  return out;
}

// Folder of this file (undefined once bundled by Next: normal
// resolution from the connector).
const HERE = import.meta.dirname as string | undefined;

// `@getrunbase/node-sdk[/runtime]` always resolved to this package: the connector
// does not need to install it to be bundled.
const sdkPlugin = (here: string): Plugin => ({
  name: "runbase-node-sdk",
  setup(b) {
    b.onResolve({ filter: /^@getrunbase\/node-sdk(\/runtime)?$/ }, (a) => ({
      path: join(here, a.path.endsWith("/runtime") ? "runtime.ts" : "index.ts"),
    }));
  },
});

// Single ESM module, dependencies included: no external import and no Node
// module (the sandbox loads none).
async function bundle(c: ConnectorInfo, contents: string): Promise<string> {
  const res = await build({
    stdin: {
      contents,
      resolveDir: c.dir,
      loader: "ts",
      sourcefile: "connector-entry.ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    minify: true,
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
    plugins: HERE ? [sdkPlugin(HERE)] : [],
    // zod from this package if the connector does not have its dependencies yet.
    nodePaths: HERE ? [join(HERE, "../node_modules")] : [],
    logLevel: "silent",
  });
  const code = res.outputFiles[0]!.text;
  if (code.length > MAX_BUNDLE)
    throw new Error(
      `${c.name}: bundle too large (${code.length} > ${MAX_BUNDLE} bytes)`,
    );
  return code;
}

// Sandbox code: default export = connector runtime.
export const bundleConnector = (c: ConnectorInfo) =>
  bundle(
    c,
    `import * as mod from ${JSON.stringify(c.entry)};
import { connectorRuntime } from "@getrunbase/node-sdk/runtime";
export default connectorRuntime(mod);`,
  );

// Nodes loaded in Node (CLI, registry) from the same bundle as the
// sandbox: trusted author code, outside the sandbox.
export async function loadNodes(c: ConnectorInfo): Promise<Node[]> {
  const code = await bundle(
    c,
    `import * as mod from ${JSON.stringify(c.entry)}; export default mod;`,
  );
  const dir = await mkdtemp(join(tmpdir(), "runbase-node-"));
  try {
    const file = join(dir, "connector.mjs");
    await writeFile(file, code);
    return nodesOf((await import(pathToFileURL(file).href)).default);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type RegistryEntry = {
  name: string;
  version: string;
  label: string;
  description: string;
  path: string;
  nodes: NodeManifest[];
};
export type Registry = { connectors: RegistryEntry[] };

// Static registry `<root>/registry.json`: manifests of each connector
// in the folder (catalog without running code).
export async function buildRegistry(root: string): Promise<Registry> {
  const connectors: RegistryEntry[] = [];
  for (const c of await listConnectors(root))
    connectors.push({
      name: c.name,
      version: c.version,
      label: c.label,
      description: c.description,
      path: c.dir.slice(resolve(root).length + 1),
      nodes: (await loadNodes(c)).map((n) => n.manifest()),
    });
  return { connectors };
}
