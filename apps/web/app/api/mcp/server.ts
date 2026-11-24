// Single MCP handler per process. The request context
// (principal, x-workspace-id header) goes through AsyncLocalStorage: no state
// shared between users, tool definitions are built once.
import { createMcpHandler } from "mcp-handler";
import type { McpPrincipal } from "@runbase/core/tenant";
import { registerTools, withMcpRequest } from "./tools";
import { MCP_INSTRUCTIONS } from "./instructions";

const handler = createMcpHandler(registerTools, {
  serverInfo: { name: "runbase", version: "0.1.0" },
  instructions: MCP_INSTRUCTIONS,
});

export function serveMcp(
  principal: McpPrincipal,
  req: Request,
  header = req.headers.get("x-workspace-id") || undefined,
) {
  return withMcpRequest({ principal, header }, () => handler(req));
}
