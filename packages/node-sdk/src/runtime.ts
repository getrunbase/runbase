// Entry point of a connector bundled for the functions sandbox: the
// default function receives `{ __runbase: "manifest" }` (list of nodes) or
// `{ __runbase: "run", node, input }` (runs a node).
import {
  nodesOf,
  oauthFetch,
  OAUTH_TOKEN_SECRET,
  type NodeManifest,
} from "./index.ts";

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
    const { [OAUTH_TOKEN_SECRET]: token, ...secrets } = ctx.secrets ?? {};
    const base = globalThis.fetch.bind(globalThis);
    return node.execute(req.input, {
      secrets,
      fetch:
        token && node.auth?.oauth
          ? oauthFetch(base, token, node.auth.domains ?? [])
          : base,
      test: ctx.test === true,
    });
  };
}
