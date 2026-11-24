// Workflow block registry. A block = a file in
// ./catalog exported by ./catalog/index.ts; the engine only knows this contract.
import { z } from "zod";
import type { Block } from "./block";
import { functionsService, runLogged, type FunctionRow } from "../functions";
import { decryptAll } from "../secrets";
import type { TenantContext } from "../tenant";
import * as catalog from "./catalog";
import { connectorBlocks, NODE_PREFIX } from "./connectors";

export * from "./block";
export { render } from "./render";

export const blocks: Record<string, Block> = Object.fromEntries(
  Object.values(catalog as Record<string, Block>).map((b) => [b.type, b]),
);

// Workspace function seen as a `fn.<name>` block. Branches: enum
// of `branch` in the outputSchema (custom condition), otherwise `ok`. The function
// returns `{ branch, ...output }`; without `branch`, the first one is taken.
// Failure convention (A3): `{ ok: false, error }` (or an exception) makes
// the step fail: retry according to its policy, then failed run and error
// center.
function functionBlock(ctx: TenantContext, f: FunctionRow): Block {
  const out = f.outputSchema as {
    properties?: { branch?: { enum?: string[] } };
  };
  const branches = out.properties?.branch?.enum ?? ["ok"];
  const perms = f.permissions as {
    domains: string[];
    secrets: string[];
    records?: string;
    events?: string;
  };
  return {
    type: `fn.${f.name}`,
    label: f.name,
    description: "Workspace function.",
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.unknown(),
    branches,
    // Declared network, record or event writes = possible side effect:
    // simulated in dry run.
    sideEffect:
      perms.domains.length > 0 ||
      perms.records === "write" ||
      perms.events === "write",
    run: async (input, bctx) => {
      // Logged output (functions.logs, run step detail).
      const { output } = await runLogged(ctx, f, input, {
        source: "workflow",
        secrets: perms.secrets.length ? await decryptAll(ctx) : {},
        run: bctx.run && { ...bctx.run },
        signal: bctx.signal,
      });
      const res = output as { branch?: unknown; ok?: unknown; error?: unknown };
      if (res && typeof res === "object" && res.ok === false)
        // eslint-disable-next-line no-restricted-syntax -- connector error relayed as is
        throw new Error(
          `${f.name}: ${
            typeof res.error === "string"
              ? res.error
              : (JSON.stringify(res.error) ?? "returned ok: false")
          }`,
        );
      const branch = res?.branch;
      return {
        branch: typeof branch === "string" ? branch : branches[0]!,
        output,
      };
    },
  };
}

// Block by type: static catalog, connector node `node.<id>`, or
// function: `fn.<name>` (latest version) or `fn.<name>@<version>` (pinned
// version).
export async function getBlock(
  ctx: TenantContext,
  type: string,
): Promise<Block | undefined> {
  if (type.startsWith(NODE_PREFIX)) return (await connectorBlocks()).get(type);
  if (!type.startsWith("fn.")) return blocks[type];
  const [name, v] = type.slice(3).split("@");
  if (v !== undefined && !/^[1-9]\d*$/.test(v)) return undefined;
  const f = await functionsService.get(ctx, name!, v ? Number(v) : undefined);
  return f ? functionBlock(ctx, f) : undefined;
}

export const blocksService = {
  // Catalog with JSON schemas (UI and MCP): static blocks, connector
  // nodes (`node.<id>`); with ctx, the workspace functions as
  // `fn.<nom>`.
  list: async (ctx?: TenantContext) => {
    const fns = ctx
      ? (await functionsService.list(ctx)).map((f) => ({
          type: `fn.${f.name}`,
          label: f.name,
          description: "Workspace function.",
          branches: functionBlock(ctx, f).branches,
          dynamicBranches: false,
          inputSchema: f.inputSchema,
          outputSchema: f.outputSchema,
        }))
      : [];
    return [...Object.values(blocks), ...(await connectorBlocks()).values()]
      .map((b) => ({
        type: b.type,
        label: b.label,
        description: b.description,
        branches: b.branches,
        dynamicBranches: !!b.branchesFor,
        inputSchema: z.toJSONSchema(b.inputSchema) as unknown,
        outputSchema: z.toJSONSchema(b.outputSchema) as unknown,
      }))
      .concat(fns);
  },
};
