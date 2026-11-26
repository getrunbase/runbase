// Token side of OAuth connections, used by the engine: client lookup, token
// requests and refresh. No dependency on the connector catalog (blocks/
// connectors imports this module).
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { NodeOAuth } from "@getrunbase/node-sdk";
import { connections } from "../db/schema";
import { appError } from "../errors/app-error";
import { getExtensions, type OAuthClient } from "../extensions";
import { decryptWith, encryptWith } from "../secrets/crypto";
import { workspaceDek } from "../secrets";
import { withTenant, type TenantContext, type Tx } from "../tenant";

export const envKey = (provider: string) =>
  `OAUTH_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

export async function oauthClient(provider: string): Promise<OAuthClient | null> {
  const managed = await getExtensions().credentials.oauthClient(provider);
  if (managed) return managed;
  const k = envKey(provider);
  const clientId = process.env[`${k}_CLIENT_ID`];
  const clientSecret = process.env[`${k}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.coerce.number().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

export async function tokenRequest(p: Pick<NodeOAuth, "provider" | "tokenUrl">, client: OAuthClient, params: Record<string, string>) {
  const res = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ ...params, client_id: client.clientId, client_secret: client.clientSecret }),
  });
  const text = await res.text();
  if (!res.ok)
    throw appError("connections.tokenFailed", "{provider} token request failed ({status}): {body}", {
      provider: p.provider,
      status: res.status,
      body: text.slice(0, 300),
    });
  return tokenResponse.parse(JSON.parse(text));
}

export const expiry = (s?: number) => (s ? new Date(Date.now() + s * 1000) : null);

export type Row = typeof connections.$inferSelect;

export async function store(tx: Tx, ctx: TenantContext, row: Row, accessToken: string, t: z.infer<typeof tokenResponse>) {
  const dek = await workspaceDek(tx, ctx);
  await tx
    .update(connections)
    .set({
      accessTokenEncrypted: encryptWith(dek, accessToken),
      // Providers may omit the refresh token on refresh: keep the old one.
      ...(t.refresh_token && { refreshTokenEncrypted: encryptWith(dek, t.refresh_token) }),
      expiresAt: expiry(t.expires_in),
      updatedAt: new Date(),
    })
    .where(eq(connections.id, row.id));
}

const missing = (provider: string, name?: string) =>
  name
    ? appError("connections.notFound", "No {provider} connection named {name}: connect it in Settings › Connections", { provider, name }, { kind: "not_found" })
    : appError("connections.missing", "Connect {provider} first in Settings › Connections", { provider }, { kind: "not_found" });

// Valid access token of a connection (engine only, never exposed).
// `name` optional when the workspace has a single connection for the provider.
export async function accessToken(ctx: TenantContext, oauth: Pick<NodeOAuth, "provider" | "tokenUrl">, name?: string) {
  const provider = oauth.provider;
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.workspaceId, ctx.workspaceId),
          eq(connections.provider, provider),
          ...(name ? [eq(connections.name, name)] : []),
        ),
      )
      .for("update");
    if (rows.length !== 1)
      throw rows.length
        ? appError("connections.ambiguous", "Several {provider} connections: set the connection input ({names})", {
            provider,
            names: rows.map((r) => r.name).join(", "),
          })
        : missing(provider, name);
    const row = rows[0]!;
    const dek = await workspaceDek(tx, ctx);
    // Still valid for at least a minute: use it.
    if (!row.expiresAt || row.expiresAt.getTime() > Date.now() + 60_000)
      return decryptWith(dek, row.accessTokenEncrypted);
    if (!row.refreshTokenEncrypted)
      throw appError("connections.expired", "{provider} connection {name} expired: reconnect it", { provider, name: row.name });
    const client = await oauthClient(provider);
    if (!client)
      throw appError(
        "connections.notConfigured",
        "{provider} is not configured: set {key}_CLIENT_ID and {key}_CLIENT_SECRET",
        { provider, key: envKey(provider) },
      );
    let t;
    try {
      t = await tokenRequest(oauth, client, {
        grant_type: "refresh_token",
        refresh_token: decryptWith(dek, row.refreshTokenEncrypted),
      });
    } catch {
      throw appError("connections.expired", "{provider} connection {name} expired: reconnect it", { provider, name: row.name });
    }
    await store(tx, ctx, row, t.access_token, t);
    return t.access_token;
  });
}

