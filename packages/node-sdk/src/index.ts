// Runbase node SDK (MIT): contract of a connector node, taken from
// `Block` (packages/core/src/blocks/block.ts) without depending on the core. A
// connector exports by default a node or a list of nodes; the core
// runs them in the Deno functions sandbox (no disk, env or
// process access; network limited to `auth.domains`, secrets limited to `auth.secrets`).
import { z } from "zod";

// `<connector>.<action>` identifier (lowercase, digits, `_`, `-`).
export const NODE_ID = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

export type NodeAuth = {
  // Workspace vault secrets read by the node (`ctx.secrets`).
  secrets?: string[];
  // Reachable domains (fetch); no network if empty.
  domains?: string[];
};

export type NodeContext = {
  secrets: Record<string, string>;
  fetch: typeof fetch;
  // Test run.
  test: boolean;
};

// Result of a multi-branch node: `{ branch, output }`.
export type Routed<O> = { branch: string; output: O };

export type NodeExample = {
  input: unknown;
  // Expected output (strict comparison); absent: only validation counts.
  output?: unknown;
  secrets?: Record<string, string>;
};

export type NodeConfig<I extends z.ZodType, O extends z.ZodType> = {
  id: string;
  label?: string;
  description?: string;
  inputs: I;
  outputs: O;
  auth?: NodeAuth;
  // Possible outputs; `["ok"]` by default.
  branches?: readonly string[];
  // Side effect (simulated in dry run); by default true as soon as a domain is
  // declared.
  sideEffect?: boolean;
  // Cases played by `runbase node test` (no network: ctx.fetch refuses).
  examples?: NodeExample[];
  run: (
    input: z.output<I>,
    ctx: NodeContext,
  ) => Promise<z.input<O> | Routed<z.input<O>>>;
};

export type NodeManifest = {
  id: string;
  label: string;
  description: string;
  branches: string[];
  sideEffect: boolean;
  auth: { secrets: string[]; domains: string[] };
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
};

export type Node<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> = NodeConfig<I, O> & {
  readonly kind: "runbase.node";
  // Validates the input, runs, validates the output and the branch.
  execute: (
    input: unknown,
    ctx?: Partial<NodeContext>,
  ) => Promise<{ branch: string; output: z.output<O> }>;
  manifest: () => NodeManifest;
};

const isRouted = (v: unknown): v is Routed<unknown> =>
  !!v &&
  typeof v === "object" &&
  Object.keys(v).length === 2 &&
  "branch" in v &&
  "output" in v &&
  typeof (v as { branch: unknown }).branch === "string";

const noNetwork: typeof fetch = () =>
  Promise.reject(new TypeError("network disabled: no fetch in this context"));

export function defineNode<I extends z.ZodType, O extends z.ZodType>(
  config: NodeConfig<I, O>,
): Node<I, O> {
  if (!NODE_ID.test(config.id))
    throw new Error(
      `defineNode: invalid id "${config.id}" (expected <connector>.<action>)`,
    );
  if (typeof config.run !== "function")
    throw new Error(`defineNode ${config.id}: run must be a function`);
  const branches = [...(config.branches ?? ["ok"])];
  if (!branches.length)
    throw new Error(`defineNode ${config.id}: branches cannot be empty`);
  const auth = {
    secrets: [...(config.auth?.secrets ?? [])],
    domains: [...(config.auth?.domains ?? [])],
  };
  const sideEffect = config.sideEffect ?? auth.domains.length > 0;

  return {
    ...config,
    kind: "runbase.node",
    async execute(raw, ctx = {}) {
      const parsed = config.inputs.safeParse(raw);
      if (!parsed.success)
        throw new Error(
          `${config.id}: invalid input: ${z.prettifyError(parsed.error)}`,
        );
      const res = await config.run(parsed.data as z.output<I>, {
        secrets: ctx.secrets ?? {},
        fetch: ctx.fetch ?? noNetwork,
        test: ctx.test ?? false,
      });
      const [branch, value] = isRouted(res)
        ? [res.branch, res.output]
        : [branches[0]!, res];
      if (!branches.includes(branch))
        throw new Error(`${config.id}: unknown branch "${branch}"`);
      const out = config.outputs.safeParse(value);
      if (!out.success)
        throw new Error(
          `${config.id}: invalid output: ${z.prettifyError(out.error)}`,
        );
      return { branch, output: out.data as z.output<O> };
    },
    manifest: () => ({
      id: config.id,
      label: config.label ?? config.id,
      description: config.description ?? "",
      branches,
      sideEffect,
      auth,
      inputSchema: z.toJSONSchema(config.inputs, { io: "input" }) as Record<
        string,
        unknown
      >,
      outputSchema: z.toJSONSchema(config.outputs) as Record<string, unknown>,
    }),
  };
}

const isNode = (v: unknown): v is Node =>
  !!v && typeof v === "object" && (v as Node).kind === "runbase.node";

// Nodes exported by a connector module: `export default node`,
// `export default [nodes]`, or named exports.
export function nodesOf(mod: unknown): Node[] {
  const m = mod as Record<string, unknown> | undefined;
  const def = m?.default ?? m;
  const list = Array.isArray(def)
    ? def
    : isNode(def)
      ? [def]
      : Object.values((def ?? {}) as object);
  const nodes = list.filter(isNode);
  if (!nodes.length) throw new Error("connector exports no node (defineNode)");
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) throw new Error(`duplicate node id "${n.id}"`);
    seen.add(n.id);
  }
  return nodes;
}
