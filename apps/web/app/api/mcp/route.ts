// MCP server, streamable HTTP transport. Auth: OAuth token (Better Auth
// mcp) or, as a fallback for scripts and CI, API key `Authorization: Bearer agk_…`.
import { requireMcpAuth } from "@better-auth/mcp";
import { auth, mcpResource, MCP_SCOPES } from "@getrunbase/core/auth";
import { apiKeyPrincipal } from "@getrunbase/core/api-keys";
import {
  accessibleWorkspaces,
  type McpPrincipal,
  type Scope,
} from "@getrunbase/core/tenant";
import { appError, authStatus, type AppError } from "@getrunbase/core/errors";
import { serveMcp } from "./server";

const errorResponse = (e: AppError, status: number) =>
  Response.json({ error: e.message, code: e.code }, { status });

// Connection bound to the account (or the key): the workspace is resolved on every tool
// call (`workspace` parameter, otherwise x-workspace-id header, client default, first one).
// Single handler (server.ts); accessible workspaces cached (short TTL).
async function serve(p: McpPrincipal, req: Request) {
  if (!(await accessibleWorkspaces(p)).length)
    return errorResponse(
      appError("mcp.workspaceForbidden", "No accessible workspace"),
      403,
    );
  return serveMcp(p, req);
}

const oauth = requireMcpAuth(
  auth,
  async (req, claims) => {
    const scopes = String(claims.scope ?? "")
      .split(" ")
      .filter((s): s is Scope => (MCP_SCOPES as readonly string[]).includes(s));
    // Token issued per workspace (before account-level connection): re-consent.
    if (claims.workspace_id)
      return errorResponse(
        appError("mcp.staleToken", "Stale token, reconnect the MCP client"),
        401,
      );
    const userId = String(claims.sub);
    // The workspace default is per client: client id required.
    const client = claims.azp ?? claims.client_id;
    if (!client)
      return errorResponse(
        appError("mcp.missingClientId", "Token without client id"),
        401,
      );
    return serve(
      { key: `user:${userId}:${String(client)}`, actor: { userId, scopes } },
      req,
    );
  },
  { resource: mcpResource, challengeScopes: MCP_SCOPES },
);

async function handler(req: Request) {
  const bearer = req.headers
    .get("authorization")
    ?.match(/^Bearer (agk_.+)$/)?.[1];
  if (!bearer) return oauth(req);
  try {
    return await serve(await apiKeyPrincipal(bearer), req);
  } catch (e) {
    const status = authStatus(e);
    if (status) return errorResponse(e as AppError, status);
    throw e;
  }
}

export { handler as GET, handler as POST, handler as DELETE };
