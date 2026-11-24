// Entry point of a connector bundled for the functions sandbox: the
// default function receives `{ __runbase: "manifest" }` (list of nodes) or
// `{ __runbase: "run", node, input }` (runs a node).
import { nodesOf, type NodeManifest } from "./index.ts";

export type RuntimeRequest =
  | { __runbase: "manifest" }
  | { __runbase: "run"; node: string; input: unknown };

export type RuntimeResult =
  NodeManifest[] | { branch: string; output: unknown };

export function connectorRuntime(mod: unknown) {
  const nodes = nodesOf(mod);
  return async (
    req: RuntimeRequest,
    ctx: { secrets?: Record<string, string>; test?: boolean } = {},
  ): Promise<RuntimeResult> => {
    if (req.__runbase === "manifest") return nodes.map((n) => n.manifest());
    const node = nodes.find((n) => n.id === req.node);
    if (!node) throw new Error(`unknown node "${req.node}"`);
    return node.execute(req.input, {
      secrets: ctx.secrets ?? {},
      fetch: globalThis.fetch.bind(globalThis),
      test: ctx.test === true,
    });
  };
}
