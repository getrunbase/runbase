// OAuth metadata at the root: oauth-protected-resource and
// oauth-authorization-server, served by the Better Auth MCP plugin.
// The issuer is `/api/auth`: the suffix-less form is rewritten (RFC 8414).
import { auth } from "@runbase/core/auth";

export function GET(req: Request) {
  const url = new URL(req.url);
  if (url.pathname === "/.well-known/oauth-authorization-server")
    url.pathname += "/api/auth";
  return auth.handler(new Request(url, req));
}
