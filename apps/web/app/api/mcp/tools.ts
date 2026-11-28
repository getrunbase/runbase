// MCP tools: thin adapters, the logic lives in @getrunbase/core.
// This file holds the request context, the definition cache and the
// registration; the tools themselves live in ./tools/, one file per domain.
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  accessibleWorkspaces,
  resolveMcpContext,
  setMcpDefault,
  type McpPrincipal,
  type TenantContext,
} from "@getrunbase/core/tenant";
import { rateLimit } from "@getrunbase/core/quotas";
import { recordError } from "@getrunbase/core/errors";
import { run, SILENT, type ToolConfig } from "./tools/shared";
import { defineAccountTools } from "./tools/account";
import { defineSchemaTools } from "./tools/schema";
import { defineRecordTools } from "./tools/records";
import { definePlatformTools } from "./tools/platform";
import { defineWorkflowTools } from "./tools/workflows";
import { defineFunctionTools } from "./tools/functions";
import { defineIntegrationTools } from "./tools/integrations";
import { definePageTools } from "./tools/pages";
import { defineRunTools } from "./tools/runs";
import { defineOperationTools } from "./tools/operations";
import { defineNoteTools } from "./tools/notes";

export { errorCode } from "./tools/shared";

// MCP request context: principal and x-workspace-id header,
// set by the route around the handler. Tool definitions are
// built only once per process; only this context varies.
export type McpRequest = { principal: McpPrincipal; header?: string };
const requestStore = new AsyncLocalStorage<McpRequest>();
export const withMcpRequest = <T>(r: McpRequest, fn: () => T): T =>
  requestStore.run(r, fn);
function mcpRequest() {
  const r = requestStore.getStore();
  if (!r) throw new Error("MCP request context missing");
  return r;
}

// Tenant context resolved for the current tool call. `ctx`, captured by the
// tool bodies, is a proxy to it: never shared between two calls.
const tenantStore = new AsyncLocalStorage<TenantContext>();
let building = false;
function currentTenant(): TenantContext {
  const t = tenantStore.getStore();
  if (t) return t;
  // Building the definitions: no tool body is executed.
  if (building) return {} as TenantContext;
  throw new Error("MCP tenant context missing");
}
const ctxProxy = new Proxy({} as TenantContext, {
  get: (_, k) => Reflect.get(currentTenant(), k),
  has: (_, k) => Reflect.has(currentTenant(), k),
  ownKeys: () => Reflect.ownKeys(currentTenant()),
  getOwnPropertyDescriptor: (_, k) => {
    const d = Reflect.getOwnPropertyDescriptor(currentTenant(), k);
    return d && { ...d, configurable: true };
  },
});

type Def = {
  cfg: ToolConfig & { inputSchema: z.ZodObject };
  fn: (input: unknown, extra: unknown) => unknown;
};
const workspaceParam = z
  .string()
  .optional()
  .describe("Workspace id or name (default: active workspace)");

// Definitions (~150 tools), built once per process.
export const toolBuilds = { count: 0 };
let defs: Map<string, Def> | undefined;
function definitions() {
  if (defs) return defs;
  const out = new Map<string, Def>();
  building = true;
  try {
    defineTools(
      {
        registerTool: (name: string, cfg: ToolConfig, fn: Def["fn"]) =>
          out.set(name, {
            cfg: {
              ...cfg,
              inputSchema: (cfg.inputSchema ?? z.object({})).extend({
                workspace: workspaceParam,
              }),
            },
            fn,
          }),
      } as unknown as McpServer,
      ctxProxy,
    );
  } finally {
    building = false;
  }
  toolBuilds.count++;
  return (defs = out);
}

// Account tools: accessible workspaces and the client's active workspace.
// The other tools receive a `workspace` parameter (id or name) injected here.
// Called for each server (the SDK creates one per request): registers only
// already-built definitions, filtered by the key's tools.
export function registerTools(server: McpServer) {
  const { principal: p, header } = mcpRequest();
  const active = (ws: { id: string }[], id: string) =>
    ws.map((w) => ({ ...w, active: w.id === id }));
  server.registerTool(
    "workspaces.list",
    {
      description:
        "Lists accessible workspaces (all organizations), with the active one marked.",
    },
    () =>
      run(async () => {
        const ctx = await resolveMcpContext(p, undefined, header);
        return active(await accessibleWorkspaces(p), ctx.workspaceId);
      }),
  );
  server.registerTool(
    "workspaces.use",
    {
      description: "Sets the default workspace for this client's next calls.",
      inputSchema: z.object({
        workspace: z.string().describe("Workspace id or name"),
      }),
    },
    ({ workspace }) =>
      run(async () => {
        const ctx = await setMcpDefault(p, workspace);
        return active(await accessibleWorkspaces(p), ctx.workspaceId).find(
          (w) => w.active,
        );
      }),
  );

  const byId = new Set(["workspaces.rename", "workspaces.delete"]);
  for (const [name, def] of definitions()) {
    // Key limited to some tools: the others are not exposed.
    if (p.tools && !p.tools.includes(name)) continue;
    server.registerTool(
      name,
      def.cfg,
      async (
        { workspace: ref, ...input }: { workspace?: string; id?: string },
        extra,
      ) => {
        let ctx: TenantContext;
        try {
          // rename/delete target the workspace `id`, possibly in another organization.
          const target = byId.has(name) ? (ref ?? input.id) : ref;
          ctx = await resolveMcpContext(p, target, header);
          await rateLimit(ctx, "api");
        } catch (e) {
          return run(() => Promise.reject(e));
        }
        const res = (await tenantStore.run(ctx, () =>
          def.fn(input, extra),
        )) as {
          isError?: boolean;
          content?: { text?: string }[];
        };
        const text = res?.isError ? (res.content?.[0]?.text ?? "") : null;
        const code = text?.match(/^\[([a-z_]+)\]/)?.[1] ?? "error";
        if (text !== null && !SILENT.has(code))
          // Error center, mcp source: never the secrets input.
          await recordError(ctx, {
            source: "mcp",
            request: name,
            message: text,
            payload: name.startsWith("secrets.") ? null : { input },
          }).catch(() => {});
        return res as never;
      },
    );
  }
}

function defineTools(server: McpServer, ctx: TenantContext) {
  defineAccountTools(server, ctx);
  defineSchemaTools(server, ctx);
  defineRecordTools(server, ctx);
  definePlatformTools(server, ctx);
  defineWorkflowTools(server, ctx);
  defineFunctionTools(server, ctx);
  defineIntegrationTools(server, ctx);
  definePageTools(server, ctx);
  defineRunTools(server, ctx);
  defineOperationTools(server, ctx);
  defineNoteTools(server, ctx);
}
