// Test MCP client: JSON-RPC tools/call on the handler, with a fresh owner.
// Requires DATABASE_URL and REDIS_URL.
import assert from "node:assert/strict";
import postgres from "postgres";
import type { McpPrincipal, TenantContext } from "@runbase/core/tenant";
import { serveMcp } from "./server";

export const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

export async function owner(): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values ('Mcp') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'Mcp', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

// MCP principal of a context: the user (or the key) limited to its default workspace.
const principal = (ctx: TenantContext | McpPrincipal): McpPrincipal =>
  "key" in ctx
    ? ctx
    : "userId" in ctx.actor
      ? { key: `user:${ctx.actor.userId}:test`, actor: ctx.actor }
      : {
          key: `key:${ctx.actor.apiKeyId}`,
          actor: ctx.actor,
          allowed: [ctx.workspaceId],
          organizationId: ctx.organizationId,
        };

// Raw call: returns the MCP result, errors included. The context workspace is
// passed as a header (like x-workspace-id).
export function raw(
  ctx: TenantContext | McpPrincipal,
  header = "key" in ctx ? undefined : ctx.workspaceId,
) {
  const p = principal(ctx);
  let id = 0;
  const rpc = async (method: string, params: unknown) => {
    const res = await serveMcp(
      p,
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++id,
          method,
          params,
        }),
      }),
      header,
    );
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    const msg = JSON.parse(line ? line.slice(5) : text);
    assert.ok(msg.result, `unexpected MCP response: ${text}`);
    return msg.result;
  };
  return Object.assign(
    async (name: string, args: Record<string, unknown> = {}) =>
      (await rpc("tools/call", { name, arguments: args })) as {
        isError?: boolean;
        content: { text: string }[];
      },
    {
      list: async () =>
        (await rpc("tools/list", {})).tools as {
          name: string;
          inputSchema: { properties?: Record<string, unknown> };
        }[],
    },
  );
}

// Call that fails if the tool returns an error; returns the result JSON.
export function client(ctx: TenantContext | McpPrincipal, header?: string) {
  const call = raw(ctx, ...(header ? [header] : []));
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = await call(name, args);
    if (result.isError)
      throw new Error(`${name} : ${result.content?.[0]?.text}`);
    return JSON.parse(result.content[0]!.text);
  };
}
