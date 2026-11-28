// Tenant isolation. Every business query goes through withTenant(ctx):
// transaction in the app_tenant role with SET LOCAL app.org_id, hence subject to RLS.
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { anyUuid } from "../db/any";
import { db } from "../db/client";
import { appError } from "../errors/app-error";
import { mapDbError } from "../lib/uuid";
import { mcpWorkspaceDefaults, memberships, workspaces } from "../db/schema";

export type Scope = "read" | "write" | "admin";

// Actor: user (session, or MCP OAuth token limited to its scopes) or scoped API key.
export type Actor =
  { userId: string; scopes?: Scope[] } | { apiKeyId: string; scopes: Scope[] };

export type TenantContext = {
  organizationId: string;
  workspaceId: string;
  actor: Actor;
  // Context of a test run (A4): writes (records, events) and descendant
  // runs flagged as test by default, deleted by workspace.purge_test.
  test?: boolean;
};

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const actor = ctx?.actor;
  if (
    !ctx?.organizationId ||
    !ctx.workspaceId ||
    !(actor && ("userId" in actor ? actor.userId : actor.apiKeyId))
  )
    // eslint-disable-next-line no-restricted-syntax -- internal invariant
    throw new Error("Missing tenant context");
  // Safety net: a Postgres invalid-data error (22P02…) never
  // surfaces with the SQL and the query parameters.
  return db
    .transaction(async (tx) => {
      const [r] = await tx.execute<{ ok: boolean }>(tenantSetup(ctx));
      if (!r?.ok)
        throw appError(
          "auth.accessDenied",
          "Access denied to this tenant",
          {},
          { kind: "forbidden" },
        );
      return fn(tx);
    })
    .catch((e: unknown) => {
      throw mapDbError(e);
    });
}

// A single round trip: app_tenant role, session variables and
// access check in the same SELECT. The privileges and RLS of a query
// are fixed when it starts: the check subqueries therefore read as the
// owner role, with an explicit filter on the organization.
// User: member (accepted invitation) of the workspace's organization,
// and of the workspace itself if its access is restricted (workspace_ids).
// app.workspace_id limits all tables to the context workspace
// (workspace_isolation, 0049).
// Key: not revoked, from the organization, allowed workspace; app.ws_ids
// limits all tables to its workspaces (key_workspaces, 0043) and
// app.objects to its objects (key_objects, 0044).
function tenantSetup(ctx: TenantContext) {
  const { organizationId: org, workspaceId: ws, actor } = ctx;
  const wsOk = sql`exists (select 1 from workspaces w
    where w.id = ${ws}::uuid and w.organization_id = ${org}::uuid)`;
  const base = sql`set_config('role', 'app_tenant', true),
    set_config('app.org_id', ${org}, true),
    set_config('app.workspace_id', ${ws}, true)`;
  if ("userId" in actor)
    return sql`select ${base}, (${wsOk} and exists (select 1 from memberships m
      where m.user_id = ${actor.userId} and m.organization_id = ${org}::uuid
      and m.accepted_at is not null
      and (m.workspace_ids is null or ${ws}::uuid = any (m.workspace_ids)))) as ok`;
  // Empty list: never "all" (null uuid); objects: empty = all (0044).
  return sql`select ${base},
    set_config('app.ws_ids', coalesce(nullif(array_to_string(k.workspace_ids, ','), ''),
      '00000000-0000-0000-0000-000000000000'), true),
    set_config('app.objects', coalesce(array_to_string(k.objects, ','), ''), true),
    (k.id is not null and ${ws}::uuid = any (k.workspace_ids) and ${wsOk}) as ok
    from (select 1) one left join api_keys k on k.id = ${actor.apiKeyId}::uuid
      and k.revoked_at is null and k.organization_id = ${org}::uuid`;
}

// Workspace accessible to the member: all those of the organization, or their list.
const memberOf = sql`(${memberships.workspaceIds} is null
  or ${workspaces.id} = any (${memberships.workspaceIds}))`;

// Context of a session user: their organization and the
// requested workspace, or the first one. Read outside RLS, limited to their memberships.
export async function resolveUserContext(
  userId: string,
  workspaceId?: string,
): Promise<TenantContext | null> {
  return (await resolveUserSession(userId, workspaceId))?.ctx ?? null;
}

// Single-query variant (layout): context, role in
// the workspace's organization and workspaces of that organization.
export async function resolveUserSession(userId: string, workspaceId?: string) {
  const rows = await db
    .select({
      organizationId: workspaces.organizationId,
      id: workspaces.id,
      name: workspaces.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(
      workspaces,
      eq(workspaces.organizationId, memberships.organizationId),
    )
    .where(
      and(
        eq(memberships.userId, userId),
        isNotNull(memberships.acceptedAt),
        memberOf,
      ),
    )
    .orderBy(workspaces.createdAt);
  const ws = rows.find((w) => w.id === workspaceId) ?? rows[0];
  if (!ws) return null;
  const ctx: TenantContext = {
    organizationId: ws.organizationId,
    workspaceId: ws.id,
    actor: { userId },
  };
  return {
    ctx,
    role: ws.role,
    workspaces: rows
      .filter((w) => w.organizationId === ws.organizationId)
      .map(({ id, name }) => ({ id, name })),
  };
}

// Short cache of resolveUserSession (layout called on each navigation). No
// access risk: withTenant rechecks membership on each transaction;
// a role or a workspace list can only be up to SESSION_TTL_MS old.
const SESSION_TTL_MS = 10_000;
const sessionCache = new Map<
  string,
  { at: number; v: Awaited<ReturnType<typeof resolveUserSession>> }
>();
export async function resolveUserSessionCached(
  userId: string,
  workspaceId?: string,
) {
  const key = `${userId}:${workspaceId ?? ""}`;
  const hit = sessionCache.get(key);
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.v;
  const v = await resolveUserSession(userId, workspaceId);
  if (sessionCache.size > 1000) sessionCache.clear();
  sessionCache.set(key, { at: Date.now(), v });
  return v;
}

// MCP principal: user account (OAuth token, token scopes) or
// API key limited to its workspaces (of its organization). `key` identifies the client for its default.
export type McpPrincipal = {
  key: string;
  actor: Actor;
  allowed?: string[];
  organizationId?: string;
  // Key limited to some MCP tools (null/missing = all).
  tools?: string[] | null;
  // MCP session (Mcp-Session-Id): scopes the workspaces.use default, so two
  // agents sharing one key never write into each other's workspace.
  session?: string;
};

// Row key of the workspaces.use default: per session when the client sends one.
const defaultKey = (p: McpPrincipal) =>
  p.session ? `${p.key}#session:${p.session}` : p.key;

// Cache of accessible workspaces: MCP reads them on each tool
// call. Short TTL (bounds staleness between processes), cleared locally on
// each change of members or workspaces. Key = full identity of the
// principal: no sharing between users or between keys.
const ACCESS_TTL_MS = 10_000;
const ACCESS_MAX = 5_000;
const accessCache = new Map<
  string,
  { at: number; list: Promise<WorkspaceRef[]> }
>();
type WorkspaceRef = { id: string; name: string; organizationId: string };

const accessKey = (p: McpPrincipal) =>
  "userId" in p.actor
    ? `user:${p.actor.userId}`
    : `key:${p.actor.apiKeyId}:${p.organizationId ?? ""}:${(p.allowed ?? []).join(",")}`;

export function invalidateWorkspaceAccess() {
  accessCache.clear();
  sessionCache.clear();
}

// Workspaces accessible to MCP: through memberships (user) or those of the key.
// Read outside RLS, limited to the principal.
export async function accessibleWorkspaces(
  p: McpPrincipal,
): Promise<WorkspaceRef[]> {
  const key = accessKey(p);
  const hit = accessCache.get(key);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return [...(await hit.list)];
  if (accessCache.size >= ACCESS_MAX) accessCache.clear();
  const list = loadAccessibleWorkspaces(p);
  accessCache.set(key, { at: Date.now(), list });
  // Failure: never cached.
  list.catch(() => {
    if (accessCache.get(key)?.list === list) accessCache.delete(key);
  });
  return [...(await list)];
}

async function loadAccessibleWorkspaces(
  p: McpPrincipal,
): Promise<WorkspaceRef[]> {
  const cols = {
    id: workspaces.id,
    name: workspaces.name,
    organizationId: workspaces.organizationId,
  };
  if ("userId" in p.actor)
    return (
      db
        .select(cols)
        .from(memberships)
        .innerJoin(
          workspaces,
          eq(workspaces.organizationId, memberships.organizationId),
        )
        // Accepted invitations; an end user has no MCP access.
        .where(
          and(
            eq(memberships.userId, p.actor.userId),
            isNotNull(memberships.acceptedAt),
            ne(memberships.role, "end_user"),
            memberOf,
          ),
        )
        .orderBy(workspaces.createdAt)
    );
  const ids = p.allowed ?? [];
  if (!ids.length || !p.organizationId) return [];
  const rows = await db
    .select(cols)
    .from(workspaces)
    .where(
      and(
        anyUuid(workspaces.id, ids),
        eq(workspaces.organizationId, p.organizationId),
      ),
    );
  return ids.flatMap((id) => rows.filter((w) => w.id === id));
}

type Ws = WorkspaceRef;

// Workspace designated by id or exact name (case-insensitive), among the accessible ones.
function pick(list: Ws[], ref: string) {
  const byId = list.find((w) => w.id === ref);
  if (byId) return byId;
  const byName = list.filter((w) => w.name.toLowerCase() === ref.toLowerCase());
  if (byName.length > 1)
    throw appError(
      "workspaces.ambiguousName",
      "Ambiguous workspace name: {ref} (use the id)",
      { ref },
    );
  if (!byName[0])
    throw appError(
      "workspaces.forbidden",
      "Workspace inaccessible: {ref}",
      {
        ref,
      },
      { kind: "forbidden" },
    );
  return byName[0];
}

// MCP tenant context: requested workspace > client default > `fallback` (header
// x-workspace-id) > first accessible. A requested but inaccessible workspace is
// refused (never a silent fallback). With `write`, a principal that reaches
// several workspaces and has no explicit choice (param, default, header) is
// refused: a write never lands in a guessed workspace.
export async function resolveMcpContext(
  p: McpPrincipal,
  ref?: string,
  fallback?: string,
  opts: { write?: boolean } = {},
): Promise<TenantContext> {
  const list = await accessibleWorkspaces(p);
  let ws: Ws | undefined;
  if (ref) ws = pick(list, ref);
  else {
    const [def] = await db
      .select({ id: mcpWorkspaceDefaults.workspaceId })
      .from(mcpWorkspaceDefaults)
      .where(eq(mcpWorkspaceDefaults.principal, defaultKey(p)));
    ws = list.find((w) => w.id === def?.id);
    if (!ws && fallback) ws = pick(list, fallback);
    if (!ws && opts.write && list.length > 1)
      throw appError(
        "workspaces.workspaceRequired",
        "Several workspaces are accessible: pass `workspace` or call workspaces.use first ({workspaces})",
        { workspaces: list.map((w) => `${w.name} (${w.id})`).join(", ") },
      );
    ws ??= list[0];
  }
  if (!ws)
    throw appError("workspaces.noneAccessible", "No accessible workspace");
  return {
    organizationId: ws.organizationId,
    workspaceId: ws.id,
    actor: p.actor,
  };
}

// Sets the default workspace of the MCP client, after the access check.
export async function setMcpDefault(p: McpPrincipal, ref: string) {
  const ctx = await resolveMcpContext(p, ref);
  await db
    .insert(mcpWorkspaceDefaults)
    .values({ principal: defaultKey(p), workspaceId: ctx.workspaceId })
    .onConflictDoUpdate({
      target: mcpWorkspaceDefaults.principal,
      set: { workspaceId: ctx.workspaceId, updatedAt: new Date() },
    });
  return ctx;
}
