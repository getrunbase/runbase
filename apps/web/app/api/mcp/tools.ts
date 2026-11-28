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
  workspaceListHint,
  type McpPrincipal,
  type TenantContext,
} from "@getrunbase/core/tenant";
import { rateLimit } from "@getrunbase/core/quotas";
import { appError, recordError } from "@getrunbase/core/errors";
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

// Unwraps optional/nullable/default wrappers down to the inner schema.
function inner(s: z.ZodType): z.ZodType {
  let cur = s as z.ZodType & { def: { innerType?: z.ZodType } };
  while (cur.def.innerType) cur = cur.def.innerType as typeof cur;
  return cur;
}

// Path of a nested field named `key` (e.g. `pins` -> `definition.pins`).
export function nestedPath(
  schema: z.ZodType,
  key: string,
  prefix = "",
  depth = 0,
): string | undefined {
  const s = inner(schema);
  if (!(s instanceof z.ZodObject) || depth > 3) return;
  const shape = s.shape as Record<string, z.ZodType>;
  if (prefix && key in shape) return prefix + key;
  for (const [k, v] of Object.entries(shape)) {
    const found = nestedPath(v, key, `${prefix}${k}.`, depth + 1);
    if (found) return found;
  }
}

// Strict input schema: an unknown key is refused (never silently dropped),
// with a hint when the key exists deeper in the schema.
export function strictInput(schema: z.ZodObject) {
  const shape = { ...schema.shape, workspace: workspaceParam };
  const strict: z.ZodObject = z.strictObject(shape, {
    error: (iss) => {
      if (iss.code !== "unrecognized_keys") return undefined;
      const hints = iss.keys.map((k) => {
        const path = nestedPath(strict, k);
        return path ? `${k} (did you mean ${path}?)` : k;
      });
      return `Unknown parameter${hints.length > 1 ? "s" : ""}: ${hints.join(", ")}. Accepted: ${Object.keys(shape).join(", ")}`;
    },
  });
  return strict;
}

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
              inputSchema: strictInput(cfg.inputSchema ?? z.object({})),
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
  // Active workspace, reported the same way by workspaces.list and
  // workspaces.create. Without an MCP session there is no persisted default
  // (a key-wide default would be shared by every client of the key): only
  // the x-workspace-id header counts, otherwise there is no active workspace.
  const activeId = async (): Promise<string | null> => {
    if (!p.session)
      return header ? (await resolveMcpContext(p, header)).workspaceId : null;
    return (await resolveMcpContext(p, undefined, header)).workspaceId;
  };
  const mark = (ws: { id: string }[], id: string | null) =>
    ws.map((w) => ({ ...w, active: w.id === id }));
  server.registerTool(
    "workspaces.list",
    {
      description:
        "Lists accessible workspaces (all organizations), with the active one marked.",
    },
    async () => {
      const res = await run(async () =>
        mark(await accessibleWorkspaces(p), await activeId()),
      );
      if (!p.session && !header && !res.isError)
        res.content.push({ type: "text", text: `workspace: ${NO_SESSION}` });
      return res;
    },
  );
  server.registerTool(
    "workspaces.use",
    {
      description:
        "Sets the default workspace for the next calls of this MCP session. Without an MCP session nothing is persisted: pass `workspace` on every call.",
      inputSchema: z.strictObject({
        workspace: z.string().describe("Workspace id or name"),
      }),
    },
    ({ workspace }) =>
      run(async () => {
        if (!p.session) {
          // Access check only: a sessionless default would leak to every
          // other client of the same key.
          const ctx = await resolveMcpContext(p, workspace);
          const w = (await accessibleWorkspaces(p)).find(
            (x) => x.id === ctx.workspaceId,
          );
          return {
            ...w,
            active: false,
            persisted: false,
            note: `Not persisted: this connection has no MCP session (Mcp-Session-Id). Pass workspace: "${ctx.workspaceId}" on every call.`,
          };
        }
        const ctx = await setMcpDefault(p, workspace);
        return {
          ...mark(await accessibleWorkspaces(p), ctx.workspaceId).find(
            (w) => w.active,
          ),
          persisted: true,
        };
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
          let target = byId.has(name) ? (ref ?? input.id) : ref;
          // workspaces.create acts on an organization: it never resolves the
          // active workspace (possibly another agent's, or one this actor
          // cannot administer). Without `workspace`, any workspace of the
          // single accessible organization stands for it.
          if (name === "workspaces.create" && !target) {
            const list = await accessibleWorkspaces(p);
            if (new Set(list.map((w) => w.organizationId)).size > 1)
              throw appError(
                "workspaces.createOrgRequired",
                "Several organizations are accessible: pass `workspace` (any workspace of the target organization) ({workspaces})",
                { workspaces: workspaceListHint(list) },
              );
            target = list[0]?.id;
          }
          ctx = await resolveMcpContext(p, target, header, {
            write: isWriteTool(name),
            account: isAccountTool(name),
          });
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
        if (!res?.isError && isWriteTool(name) && Array.isArray(res?.content)) {
          // Workspace the call actually used: the agent sees where it wrote.
          const list = await accessibleWorkspaces(p).catch(() => []);
          const label = (id: string, name?: string) =>
            `${JSON.stringify(name ?? list.find((w) => w.id === id)?.name ?? id)} (${id})`;
          const used = label(ctx.workspaceId);
          let text = `workspace: ${used}`;
          if (name === "workspaces.create") {
            const act = await activeId().catch(() => null);
            const next = p.session
              ? `Call workspaces.use { workspace: "%ID%" } to work in it.`
              : `Pass workspace: "%ID%" on each call to work in it.`;
            // The new workspace does not become the active one.
            const created = parseJson(res.content[0]?.text) as {
              id?: string;
              name?: string;
            } | null;
            if (created?.id)
              text = `workspace: created ${label(created.id, created.name)}; ${act ? `active is still ${label(act)}.` : NO_SESSION} ${next.replace("%ID%", created.id)}`;
          }
          res.content.push({ type: "text", text } as { text: string });
        }
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

const NO_SESSION =
  "no active workspace: this connection has no MCP session (Mcp-Session-Id), so pass `workspace` on every call.";

function parseJson(text?: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// Read-only tools: they keep the first-workspace fallback and their response
// does not carry the workspace line. Any other tool is a write and needs an
// explicit workspace when several are accessible. `.test` stays a write
// because functions.test can write.
const READ_VERBS =
  /\.(list|get|describe|search|dependencies|settings|history|logs|versions|types|funnel|export|download|errors|guide|examples|screenshot|saved|sql|waiting|providers|ai_budget|trash|validate|dry_run|test_step)$/;
// Organization-level tools: no workspace choice needed inside one organization.
export const isAccountTool = (name: string) =>
  name === "workspaces.create" || name.startsWith("members.");
export const isWriteTool = (name: string) => !READ_VERBS.test(name);

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
