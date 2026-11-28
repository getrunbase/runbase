// Workflow block registry. A block = a file in
// ./catalog exported by ./catalog/index.ts; the engine only knows this contract.
import { z } from "zod";
import { blockContext, type Block, type BlockOption } from "./block";
import { requireScope } from "../api-keys";
import { appError } from "../errors/app-error";
import { functionsService, runLogged, type FunctionRow } from "../functions";
import { decryptAll } from "../secrets";
import type { TenantContext } from "../tenant";
import * as catalog from "./catalog";
import { connectorBlocks, NODE_PREFIX } from "./connectors";
import { triggerVariants } from "../triggers/schema";

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

// Workflow triggers (`definition.trigger`), described for the catalog.
const TRIGGERS: Record<string, { label: string; description: string }> = {
  "trigger.record_created": {
    label: "Record created",
    description: "Starts a run when a record of `object` is created.",
  },
  "trigger.record_updated": {
    label: "Record updated",
    description:
      "Starts a run when a record of `object` changes; `fields` limits it to those fields (empty: any change).",
  },
  "trigger.event": {
    label: "Event",
    description:
      "Starts a run for each event of type `event` ({{event.…}}; {{event.recordId}} = linked record).",
  },
  "trigger.schedule": {
    label: "Schedule",
    description:
      "Cron schedule (`timezone`: IANA, default UTC). With `object`: one run per record matching `filter`; without: a single run.",
  },
  "trigger.webhook": {
    label: "Incoming webhook",
    description:
      "Starts a run on each valid reception of webhook `webhook` (name). With `object` + `mapping` (field -> path relative to the body root, e.g. { email: \"email\", city: \"address.city\" }), the record is created or updated first (`match`: unique field) and the run targets it. {{event.x}} is the flattened body: body field `x`, no `payload.` prefix.",
  },
  "trigger.run_failed": {
    label: "Workflow failed",
    description:
      "Error workflow: starts when a run of another workflow fails (`workflow`: id or name to watch only one). {{event.runId}}, {{event.workflowId}}, {{event.workflowName}}, {{event.error}}, {{event.recordId}}.",
  },
  "trigger.manual": {
    label: "Manual",
    description:
      "Started by hand (editor, runs.start); `object`: optional editor context.",
  },
};

export const triggerCatalog = () =>
  triggerVariants.options.map((o) => {
    const type = o.shape.type.value;
    return {
      kind: "trigger" as const,
      type,
      ...TRIGGERS[type]!,
      inputSchema: z.toJSONSchema(o) as unknown,
    };
  });

export const blocksService = {
  // Catalog with JSON schemas (UI and MCP): static blocks, connector
  // nodes (`node.<id>`); with ctx, the workspace functions as
  // `fn.<nom>`. Deprecated blocks carry `deprecated` (replacement type):
  // the editor needs them to show existing steps.
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
        ...(b.deprecated ? { deprecated: b.deprecated } : {}),
        ...(b.app ? { app: b.app } : {}),
        ...(b.optionFields?.length ? { options: [...b.optionFields] } : {}),
        inputSchema: z.toJSONSchema(b.inputSchema) as unknown,
        outputSchema: z.toJSONSchema(b.outputSchema) as unknown,
      }))
      .concat(fns);
  },
  // Choices of a dynamic input (step form), loaded with the step's OAuth
  // connection. `write`: it calls the provider with the workspace's account.
  options: async (
    ctx: TenantContext,
    type: string,
    field: string,
    input: Record<string, unknown>,
  ): Promise<BlockOption[]> => {
    await requireScope(ctx, "write");
    const b = await getBlock(ctx, type);
    if (!b?.options || !b.optionFields?.includes(field))
      throw appError(
        "blocks.noOptions",
        "{type} has no choices for {field}",
        { type, field },
        { kind: "not_found" },
      );
    return b.options(field, input, blockContext(ctx));
  },
  // Agent-facing catalog (MCP blocks.list): blocks for new use (no
  // deprecated ones), then the triggers with `kind: "trigger"`.
  catalog: async (ctx?: TenantContext) => [
    ...(await blocksService.list(ctx))
      .filter((b) => !("deprecated" in b))
      // Logo left out: a data URL is token noise for an agent.
      .map((b) => ({
        kind: "block" as const,
        ...b,
        ...("app" in b && b.app
          ? { app: { name: b.app.name, label: b.app.label } }
          : {}),
      })),
    ...triggerCatalog(),
  ],
};
