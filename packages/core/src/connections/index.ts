// OAuth connections of connector nodes (`auth.oauth` in the node manifest).
// The core runs the authorization code flow (with PKCE), stores the tokens
// encrypted with the workspace DEK and refreshes them before they expire.
// OAuth client: managed by an extension (`credentials.oauthClient`), else
// OAUTH_<PROVIDER>_CLIENT_ID / OAUTH_<PROVIDER>_CLIENT_SECRET (self-host).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { NodeOAuth } from "@getrunbase/node-sdk";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { loadConnectors } from "../blocks/connectors";
import { connections } from "../db/schema";
import { appUrl, env } from "../env";
import { appError } from "../errors/app-error";
import { decryptWith, encryptWith } from "../secrets/crypto";
import { envKey, expiry, oauthClient, tokenRequest } from "./tokens";
import { workspaceDek } from "../secrets";
import { withTenant, type TenantContext } from "../tenant";

export { accessToken, oauthClient } from "./tokens";

export type Provider = Omit<NodeOAuth, "scopes"> & {
  scopes: string[];
  // Labels of the nodes using it.
  nodes: string[];
};

export const callbackUrl = () => `${appUrl()}/api/connections/callback`;

// Providers declared by the installed connectors; scopes merged per provider.
export async function providers(): Promise<Map<string, Provider>> {
  const out = new Map<string, Provider>();
  for (const c of await loadConnectors())
    for (const m of c.nodes) {
      const o = m.auth.oauth;
      if (!o) continue;
      const p = out.get(o.provider) ?? { ...o, scopes: [], nodes: [] };
      for (const s of o.scopes) if (!p.scopes.includes(s)) p.scopes.push(s);
      p.nodes.push(m.label);
      out.set(o.provider, p);
    }
  return out;
}

async function requireProvider(provider: string) {
  const p = (await providers()).get(provider);
  if (!p)
    throw appError("connections.unknownProvider", "Unknown OAuth provider {provider}", { provider });
  const client = await oauthClient(provider);
  if (!client)
    throw appError(
      "connections.notConfigured",
      "{provider} is not configured: set {key}_CLIENT_ID and {key}_CLIENT_SECRET",
      { provider, key: envKey(provider) },
    );
  return { p, client };
}

// State: signed claims, no server storage. The PKCE verifier is derived
// from the state, so it never leaves the server.
type State = {
  provider: string;
  name: string;
  userId: string;
  organizationId: string;
  workspaceId: string;
  nonce: string;
  exp: number;
};

const stateKey = () => {
  const k = env().BETTER_AUTH_SECRET;
  if (!k) throw appError("connections.noSecret", "BETTER_AUTH_SECRET is required for OAuth connections");
  return k;
};
const b64 = (b: Buffer) => b.toString("base64url");
const hmac = (data: string) => createHmac("sha256", stateKey()).update(data).digest();

export function signState(s: Omit<State, "nonce" | "exp">, ttlMs = 10 * 60_000) {
  const body = b64(Buffer.from(JSON.stringify({ ...s, nonce: b64(randomBytes(16)), exp: Date.now() + ttlMs })));
  return `${body}.${b64(hmac(body))}`;
}

export function verifyState(state: string): State {
  const [body = "", sig = ""] = state.split(".");
  const want = hmac(body);
  const got = Buffer.from(sig, "base64url");
  const s =
    got.length === want.length && timingSafeEqual(got, want)
      ? (JSON.parse(Buffer.from(body, "base64url").toString()) as State)
      : null;
  if (!s || s.exp < Date.now())
    throw appError("connections.badState", "OAuth connection expired or invalid, try again");
  return s;
}

const pkceVerifier = (state: string) => b64(hmac(`pkce:${state}`));
const pkceChallenge = (verifier: string) => b64(createHash("sha256").update(verifier).digest());

// Email of the connected account from an OpenID id_token. Not verified:
// display only, the token comes straight from the provider over TLS.
export function idTokenEmail(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString());
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

export const connectionNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "name: [A-Za-z0-9_-], 64 characters max");

const actorUser = (ctx: TenantContext) =>
  "userId" in ctx.actor ? ctx.actor.userId : undefined;

const ref = (id: string) => ({ type: "connection", id });

export const connectionsService = {
  // Never the tokens.
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select({
          id: connections.id,
          provider: connections.provider,
          name: connections.name,
          account: connections.account,
          createdAt: connections.createdAt,
        })
        .from(connections)
        .where(eq(connections.workspaceId, ctx.workspaceId))
        .orderBy(connections.provider, connections.name),
    );
  },

  // Providers of the installed connectors, with whether a client is set.
  providers: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const out = [];
    for (const p of (await providers()).values())
      out.push({ provider: p.provider, scopes: p.scopes, nodes: p.nodes, configured: !!(await oauthClient(p.provider)) });
    return out;
  },

  // URL to send the user to. Only a signed-in user can connect (the
  // callback checks the session against the state).
  authorizeUrl: async (ctx: TenantContext, provider: string, name?: string) => {
    await requireScope(ctx, "admin");
    const userId = actorUser(ctx);
    if (!userId) throw appError("connections.userOnly", "Only a signed-in user can connect an account");
    const { p, client } = await requireProvider(provider);
    const state = signState({
      provider,
      name: connectionNameSchema.parse(name || provider),
      userId,
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
    });
    const url = new URL(p.authorizeUrl);
    for (const [k, v] of Object.entries({
      ...p.authorizeParams,
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: callbackUrl(),
      scope: p.scopes.join(" "),
      state,
      code_challenge: pkceChallenge(pkceVerifier(state)),
      code_challenge_method: "S256",
    }))
      url.searchParams.set(k, v);
    return url.toString();
  },

  // Callback: `ctx` is the session of the user who started the flow.
  complete: async (ctx: TenantContext, state: string, code: string) => {
    const s = verifyState(state);
    if (s.userId !== actorUser(ctx) || s.organizationId !== ctx.organizationId || s.workspaceId !== ctx.workspaceId)
      throw appError("connections.badState", "OAuth connection expired or invalid, try again");
    await requireScope(ctx, "admin");
    const { p, client } = await requireProvider(s.provider);
    const t = await tokenRequest(p, client, {
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(),
      code_verifier: pkceVerifier(state),
    });
    await withTenant(ctx, async (tx) => {
      const dek = await workspaceDek(tx, ctx);
      const v = {
        provider: s.provider,
        account: idTokenEmail(t.id_token),
        scopes: t.scope ?? p.scopes.join(" "),
        accessTokenEncrypted: encryptWith(dek, t.access_token),
        refreshTokenEncrypted: t.refresh_token ? encryptWith(dek, t.refresh_token) : null,
        expiresAt: expiry(t.expires_in),
        updatedAt: new Date(),
      };
      const [row] = await tx
        .insert(connections)
        .values({ organizationId: ctx.organizationId, workspaceId: ctx.workspaceId, name: s.name, ...v })
        .onConflictDoUpdate({ target: [connections.workspaceId, connections.name], set: v })
        .returning({ id: connections.id });
      await audit(tx, ctx, "connection.set", ref(row!.id), { provider: s.provider, name: s.name, account: v.account });
    });
    return { provider: s.provider, name: s.name };
  },

  // Deletes the connection; revokes the token at the provider (best effort).
  remove: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "admin");
    const row = await withTenant(ctx, async (tx) => {
      const [r] = await tx
        .delete(connections)
        .where(and(eq(connections.workspaceId, ctx.workspaceId), eq(connections.id, id)))
        .returning();
      if (r) await audit(tx, ctx, "connection.remove", ref(id), { provider: r.provider, name: r.name });
      return r && { ...r, dek: await workspaceDek(tx, ctx) };
    });
    const p = row && (await providers()).get(row.provider);
    if (row && p?.revokeUrl) {
      const token = decryptWith(row.dek, row.refreshTokenEncrypted ?? row.accessTokenEncrypted);
      await fetch(p.revokeUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }).catch(() => {});
    }
  },
};
