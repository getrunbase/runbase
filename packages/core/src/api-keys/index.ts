// Scoped API keys, for ingestion. The plain key is returned
// only at creation; only its SHA-256 hash is stored.
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { audit } from "../audit";
import { db } from "../db/client";
import { apiKeys, memberships, workspaces } from "../db/schema";
import {
  withTenant,
  type McpPrincipal,
  type Scope,
  type TenantContext,
} from "../tenant";
import { appError, forbidden, unauthorized } from "../errors/app-error";

const rank: Record<Scope, number> = { read: 0, write: 1, admin: 2 };

// admin ⊇ write ⊇ read. Applies to any scope holder (API key, MCP OAuth token).
export const hasScope = (scopes: Scope[], needed: Scope) =>
  scopes.some((s) => rank[s] >= rank[needed]);

// Membership role -> scope: owner/admin administer, member writes
// (but manages neither workspaces, members nor keys: reserved to the admin scope),
// viewer reads. end_user reads too, but the UI only opens pages to them and
// MCP is closed to them (accessibleWorkspaces).
export const roleScope = {
  owner: "admin",
  admin: "admin",
  member: "write",
  viewer: "read",
  end_user: "read",
} as const;

// API key: its scopes. Session user: the scope derived from their role.
export async function requireScope(ctx: TenantContext, needed: Scope) {
  const actor = ctx.actor;
  let scopes: Scope[];
  if ("apiKeyId" in actor) scopes = actor.scopes;
  else {
    const [m] = await withTenant(ctx, (tx) =>
      tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, actor.userId),
            isNotNull(memberships.acceptedAt),
          ),
        ),
    );
    scopes = m ? [roleScope[m.role]] : [];
    // OAuth token: its scopes, capped by the role.
    if (actor.scopes) {
      const role = scopes;
      scopes = actor.scopes.filter((s) => hasScope(role, s));
    }
  }
  if (!hasScope(scopes, needed))
    throw forbidden("apiKeys.scopeRequired", "Scope {needed} required", {
      needed,
    });
}

// An admin key only sees and revokes keys included in its workspaces.
const withinKeyWorkspaces = sql`(coalesce(current_setting('app.ws_ids', true), '') = ''
  or ${apiKeys.workspaceIds} <@ string_to_array(current_setting('app.ws_ids', true), ',')::uuid[])`;

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export const apiKeysService = {
  // tools / objects: optional restrictions (missing or empty = everything).
  create: async (
    ctx: TenantContext,
    input: {
      name: string;
      scopes: Scope[];
      workspaceIds: string[];
      tools?: string[];
      objects?: string[];
    },
  ) => {
    await requireScope(ctx, "admin");
    const tools = input.tools?.length ? input.tools : null;
    const objects = input.objects?.length ? input.objects : null;
    const key = `agk_${randomBytes(32).toString("base64url")}`;
    return withTenant(ctx, async (tx) => {
      // Key workspaces: only those of the organization (RLS).
      const ids = input.workspaceIds.length
        ? await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(inArray(workspaces.id, input.workspaceIds))
        : [];
      if (ids.length !== new Set(input.workspaceIds).size)
        throw appError(
          "apiKeys.unknownWorkspace",
          "Unknown workspace in organization",
        );
      const [row] = await tx
        .insert(apiKeys)
        .values({
          name: input.name,
          scopes: input.scopes,
          workspaceIds: input.workspaceIds,
          tools,
          objects,
          organizationId: ctx.organizationId,
          keyHash: hash(key),
        })
        .returning({ id: apiKeys.id });
      await audit(
        tx,
        ctx,
        "api_key.create",
        { type: "api_key", id: row!.id },
        {
          name: input.name,
          scopes: input.scopes,
          workspaceIds: input.workspaceIds,
          tools,
          objects,
        },
      );
      return { id: row!.id, key };
    });
  },
  // Organization keys, without hash.
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, (tx) =>
      tx
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          scopes: apiKeys.scopes,
          workspaceIds: apiKeys.workspaceIds,
          tools: apiKeys.tools,
          objects: apiKeys.objects,
          lastUsedAt: apiKeys.lastUsedAt,
          revokedAt: apiKeys.revokedAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(withinKeyWorkspaces)
        .orderBy(desc(apiKeys.createdAt)),
    );
  },
  revoke: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), withinKeyWorkspaces));
      await audit(tx, ctx, "api_key.revoke", { type: "api_key", id });
    });
  },
};

// Resolves a key into a tenant context. Read outside RLS: the organization is
// only known after the hash lookup.
// With no requested workspace (MCP), the key's first allowed workspace.
// MCP principal of a key: the workspace is chosen per call among its own.
export async function apiKeyPrincipal(key: string): Promise<McpPrincipal> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash(key)));
  if (!row || row.revokedAt) throw unauthorized("apiKeys.invalid", "Invalid API key");
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id));
  return {
    key: `key:${row.id}`,
    actor: { apiKeyId: row.id, scopes: row.scopes },
    allowed: row.workspaceIds,
    organizationId: row.organizationId,
    tools: row.tools,
  };
}

// Context of a key by its id (page capture token issued for a key).
export async function apiKeyContext(
  id: string,
  workspaceId: string,
): Promise<TenantContext | null> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
  if (!row?.workspaceIds.includes(workspaceId)) return null;
  return {
    organizationId: row.organizationId,
    workspaceId,
    actor: { apiKeyId: row.id, scopes: row.scopes },
  };
}

export async function authenticateApiKey(
  key: string,
  workspaceId?: string,
): Promise<TenantContext> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash(key)));
  if (!row || row.revokedAt) throw unauthorized("apiKeys.invalid", "Invalid API key");
  workspaceId ||= row.workspaceIds[0] ?? "";
  if (!row.workspaceIds.includes(workspaceId))
    throw forbidden(
      "apiKeys.workspaceNotAllowed",
      "Workspace not allowed for this key",
    );
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id));
  return {
    organizationId: row.organizationId,
    workspaceId,
    actor: { apiKeyId: row.id, scopes: row.scopes },
  };
}
