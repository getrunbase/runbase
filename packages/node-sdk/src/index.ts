// Runbase node SDK (MIT): contract of a connector node, taken from
// `Block` (packages/core/src/blocks/block.ts) without depending on the core. A
// connector exports by default a node or a list of nodes; the core
// runs them in the Deno functions sandbox (no disk, env or
// process access; network limited to `auth.domains`, secrets limited to `auth.secrets`).
import { z } from "zod";

// `<connector>.<action>` identifier (lowercase, digits, `_`, `-`).
export const NODE_ID = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

// OAuth 2.0 provider of a node. The core runs the connection flow, stores and
// refreshes the tokens; `ctx.fetch` adds `Authorization: Bearer <token>` to
// requests sent to `auth.domains`. The node never handles the token.
export type NodeOAuth = {
  // Provider id shared by every node of the same service (e.g. "google").
  provider: string;
  authorizeUrl: string;
  tokenUrl: string;
  // Scopes this node needs; a connection requests the scopes of all nodes
  // of the provider.
  scopes: string[];
  // Optional token revocation endpoint (RFC 7009), called on disconnect.
  revokeUrl?: string;
  // Extra authorize query parameters (e.g. Google: access_type=offline).
  authorizeParams?: Record<string, string>;
};

export type NodeAuth = {
  // Workspace vault secrets read by the node (`ctx.secrets`).
  secrets?: string[];
  // Reachable domains (fetch); no network if empty.
  domains?: string[];
  oauth?: NodeOAuth;
};

// Reserved secret carrying the OAuth access token into the sandbox.
export const OAUTH_TOKEN_SECRET = "__RUNBASE_OAUTH_TOKEN";

// Input added to OAuth nodes: name of the workspace connection to use
// (optional when the workspace has a single connection for the provider).
export const CONNECTION_INPUT = "connection";

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

// Choice offered for an input in the step form (dropdown).
export type NodeOption = { value: string; label: string };

// Options loader of an input: called from the step form with the inputs
// already filled (partial, not validated) and the step's OAuth connection
// (`ctx.fetch` adds the token, the loader never sees it).
export type NodeOptionsLoader = (
  input: Record<string, unknown>,
  ctx: NodeContext,
) => Promise<NodeOption[]>;

const nodeOptions = z.array(z.object({ value: z.string(), label: z.string() }));

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
  // Dynamic choices per input key (e.g. the tabs of a spreadsheet).
  options?: Record<string, NodeOptionsLoader>;
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
  auth: { secrets: string[]; domains: string[]; oauth?: NodeOAuth };
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  // Input keys with an options loader (absent: none).
  options?: string[];
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
  // Runs the options loader of `field`; the output is validated.
  loadOptions: (
    field: string,
    input: unknown,
    ctx?: Partial<NodeContext>,
  ) => Promise<NodeOption[]>;
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
  const oauth = config.auth?.oauth;
  if (oauth && !(config.inputs instanceof z.ZodObject))
    throw new Error(`defineNode ${config.id}: OAuth nodes need object inputs`);
  if (oauth && !config.auth?.domains?.length)
    throw new Error(`defineNode ${config.id}: OAuth nodes need auth.domains`);
  // OAuth nodes take an optional connection name.
  const inputs = (
    oauth
      ? (config.inputs as unknown as z.ZodObject).extend({
          [CONNECTION_INPUT]: z
            .string()
            .optional()
            .describe(`Name of the ${oauth.provider} connection to use`),
        })
      : config.inputs
  ) as I;
  const auth = {
    secrets: [...(config.auth?.secrets ?? [])],
    domains: [...(config.auth?.domains ?? [])],
    ...(oauth && { oauth: { ...oauth, scopes: [...oauth.scopes] } }),
  };
  const sideEffect = config.sideEffect ?? auth.domains.length > 0;
  const loaders = config.options ?? {};
  const shape = (inputs as unknown as z.ZodObject).shape as
    Record<string, unknown> | undefined;
  for (const [k, fn] of Object.entries(loaders)) {
    if (typeof fn !== "function")
      throw new Error(
        `defineNode ${config.id}: options.${k} must be a function`,
      );
    if (!shape || !(k in shape))
      throw new Error(`defineNode ${config.id}: options.${k} is not an input`);
  }
  const ctxOf = (ctx: Partial<NodeContext>): NodeContext => ({
    secrets: ctx.secrets ?? {},
    fetch: ctx.fetch ?? noNetwork,
    test: ctx.test ?? false,
  });

  return {
    ...config,
    inputs,
    kind: "runbase.node",
    async execute(raw, ctx = {}) {
      const parsed = inputs.safeParse(raw);
      if (!parsed.success)
        throw new Error(
          `${config.id}: invalid input: ${z.prettifyError(parsed.error)}`,
        );
      const res = await config.run(parsed.data as z.output<I>, ctxOf(ctx));
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
    async loadOptions(field, input, ctx = {}) {
      const fn = Object.hasOwn(loaders, field) ? loaders[field] : undefined;
      if (!fn) throw new Error(`${config.id}: no options for "${field}"`);
      const raw =
        input && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};
      const out = nodeOptions.safeParse(await fn(raw, ctxOf(ctx)));
      if (!out.success)
        throw new Error(
          `${config.id}: invalid options for "${field}": ${z.prettifyError(out.error)}`,
        );
      return out.data;
    },
    manifest: () => ({
      id: config.id,
      label: config.label ?? config.id,
      description: config.description ?? "",
      branches,
      sideEffect,
      auth,
      inputSchema: z.toJSONSchema(inputs, { io: "input" }) as Record<
        string,
        unknown
      >,
      outputSchema: z.toJSONSchema(config.outputs) as Record<string, unknown>,
      ...(Object.keys(loaders).length && { options: Object.keys(loaders) }),
    }),
  };
}

// fetch that adds the OAuth bearer token to requests sent to `domains`
// (exact host or subdomain); other requests go out untouched.
export function oauthFetch(
  base: typeof fetch,
  token: string,
  domains: string[],
): typeof fetch {
  const matches = (host: string) =>
    domains.some((d) => host === d || host.endsWith(`.${d}`));
  return (input, init) => {
    const req = new Request(input, init);
    if (matches(new URL(req.url).hostname))
      req.headers.set("authorization", `Bearer ${token}`);
    return base(req);
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
