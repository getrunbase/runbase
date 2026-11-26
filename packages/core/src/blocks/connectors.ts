// External connectors: `defineNode` nodes (@getrunbase/node-sdk) seen
// as `node.<id>` blocks. Discovered in root folders (connectors/
// of the repo, node_modules/@getrunbase-connectors), bundled (esbuild) then
// run in the functions Deno sandbox: the core only knows the
// contract, no connector-specific logic.
import { stat, readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { z } from "zod";
import {
  bundleConnector,
  listConnectors,
  type ConnectorInfo,
  type Registry,
} from "@getrunbase/node-sdk/build";
import type { NodeManifest } from "@getrunbase/node-sdk";
import type { Block } from "./block";
import { execFunction } from "../functions/sandbox";
import { decryptAll } from "../secrets";
import { withSecrets } from "./catalog/external";
import { appError } from "../errors/app-error";
import { logger } from "../logger";

export const NODE_PREFIX = "node.";

// Root folders: RUNBASE_CONNECTORS_DIRS (separated by `:`), otherwise the nearest
// `connectors/` and `node_modules/@getrunbase-connectors/` walking up
// from the current directory.
export async function connectorRoots(): Promise<string[]> {
  const env = process.env.RUNBASE_CONNECTORS_DIRS;
  if (env !== undefined) return env.split(delimiter).filter(Boolean);
  const roots: string[] = [];
  for (const rel of [
    "connectors",
    join("node_modules", "@getrunbase-connectors"),
  ])
    for (let d = process.cwd(); ; d = dirname(d)) {
      const p = join(d, rel);
      if ((await stat(p).catch(() => null))?.isDirectory()) {
        roots.push(p);
        break;
      }
      if (dirname(d) === d) break;
    }
  return roots;
}

type Loaded = {
  info: ConnectorInfo;
  nodes: NodeManifest[];
  code: () => Promise<string>;
};

// By signature (folder + mtimes): a modified connector is reloaded.
const cache = new Map<string, Promise<Loaded>>();

const mtime = (p: string) =>
  stat(p).then(
    (s) => s.mtimeMs,
    () => 0,
  );

async function registryOf(root: string): Promise<Registry["connectors"]> {
  try {
    const r = JSON.parse(
      await readFile(join(root, "registry.json"), "utf8"),
    ) as Registry;
    return Array.isArray(r.connectors) ? r.connectors : [];
  } catch {
    return [];
  }
}

function load(
  info: ConnectorInfo,
  fromRegistry: NodeManifest[] | undefined,
): Promise<Loaded> {
  let bundled: Promise<string> | undefined;
  const code = () => (bundled ??= bundleConnector(info));
  return (async () => {
    // Static registry: catalog without running code; otherwise manifest
    // requested from the connector, in the sandbox.
    const nodes =
      fromRegistry ??
      ((await execFunction({ code: await code() }, { __runbase: "manifest" }))
        .output as NodeManifest[]);
    return { info, nodes, code };
  })();
}

// Available connectors; a failing connector is ignored (logged),
// the others stay usable. Duplicate package name: the first
// root wins.
export async function loadConnectors(): Promise<Loaded[]> {
  const out: Loaded[] = [];
  const seen = new Set<string>();
  for (const root of await connectorRoots()) {
    const reg = await registryOf(root);
    for (const info of await listConnectors(root)) {
      if (seen.has(info.name)) continue;
      seen.add(info.name);
      const sig = [
        info.dir,
        await mtime(join(info.dir, "package.json")),
        await mtime(info.entry),
      ].join(":");
      let p = cache.get(sig);
      if (!p) {
        const entry = reg.find(
          (e) => e.name === info.name && e.version === info.version,
        );
        p = load(info, entry?.nodes);
        cache.set(sig, p);
        p.catch(() => cache.delete(sig));
      }
      try {
        out.push(await p);
      } catch (e) {
        logger.error({ err: e, connector: info.name }, "connector load failed");
      }
    }
  }
  return out;
}

function nodeBlock(c: Loaded, m: NodeManifest): Block {
  return {
    type: `${NODE_PREFIX}${m.id}`,
    label: m.label,
    description: m.description,
    inputSchema: z.fromJSONSchema(m.inputSchema as never),
    outputSchema: z.fromJSONSchema(m.outputSchema as never),
    branches: m.branches,
    sideEffect: m.sideEffect,
    // `{{secret.NAME}}` in inputs is resolved (and redacted from the output),
    // as for core blocks: a node can take a URL or a key per step.
    run: (raw, bctx) => {
      const exec = async (input: unknown) => {
        const secrets =
          m.auth.secrets.length && bctx.tenant
            ? await decryptAll(bctx.tenant)
            : {};
        const { output } = await execFunction(
          {
            code: await c.code(),
            permissions: { domains: m.auth.domains, secrets: m.auth.secrets },
          },
          { __runbase: "run", node: m.id, input },
          {
            secrets,
            test:
              (bctx.scope?.run as { test?: boolean } | undefined)?.test ===
              true,
          },
        );
        const res = output as { branch?: unknown; output?: unknown } | null;
        if (!res || typeof res.branch !== "string")
          throw appError(
            "blocks.connectorBadResult",
            "{type}: connector returned no branch",
            { type: `${NODE_PREFIX}${m.id}` },
          );
        return { branch: res.branch, output: res.output };
      };
      // Workspace settings are only loaded when an input references a secret.
      return JSON.stringify(raw).includes("{{secret.")
        ? withSecrets(bctx, raw, exec)
        : exec(raw);
    },
  };
}

// Blocks of all connectors, by `node.<id>` type.
export async function connectorBlocks(): Promise<Map<string, Block>> {
  const map = new Map<string, Block>();
  for (const c of await loadConnectors())
    for (const m of c.nodes) {
      const b = nodeBlock(c, m);
      if (!map.has(b.type)) map.set(b.type, b);
    }
  return map;
}
