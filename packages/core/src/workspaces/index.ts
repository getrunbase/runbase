// Workspace management. Everything goes through withTenant: RLS per organization.
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { z } from "zod";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { appError } from "../errors/app-error";
import { apiKeys, memberships, workspaces } from "../db/schema";
import {
  invalidateWorkspaceAccess,
  withTenant,
  type TenantContext,
  type Tx,
} from "../tenant";
import { decryptAll, putSecret } from "../secrets";
import { checkQuota } from "../entitlements";

export * from "./activity";

const ws = (id: string) => ({ type: "workspace", id });

// External block settings.
export const settingsSchema = z.object({
  allowedDomains: z.array(z.string()).default([]),
  secrets: z.record(z.string(), z.string()).default({}),
  mcpServers: z
    .record(
      z.string(),
      z.object({
        url: z.string().url(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
    )
    .default({}),
  // Definition lint (src/lint): true = warnings block the save.
  lintStrict: z.boolean().default(false),
});
export type WorkspaceSettings = z.infer<typeof settingsSchema>;

// Partial update: absent keys keep their stored value (no defaults here).
const settingsPatchSchema = z.object({
  allowedDomains: settingsSchema.shape.allowedDomains.removeDefault().optional(),
  secrets: settingsSchema.shape.secrets.removeDefault().optional(),
  mcpServers: settingsSchema.shape.mcpServers.removeDefault().optional(),
  lintStrict: z.boolean().optional(),
});

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Deep merge of plain objects; arrays and scalars from `patch` replace.
export function mergeSettings(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isObject(v) && isObject(base[k]) ? mergeSettings(base[k], v) : v;
  }
  return out;
}

// Internal read (workflow engine): never exposed as is to the UI.
// `secrets`: decrypted vault values.
export async function workspaceSettings(ctx: TenantContext) {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId)),
  );
  const settings = settingsSchema.parse(row?.settings ?? {});
  return { ...settings, secrets: await decryptAll(ctx) };
}

const countIn = async (tx: Tx, organizationId: string) => {
  const [{ n }] = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(workspaces)
    .where(eq(workspaces.organizationId, organizationId))) as [{ n: number }];
  return n;
};

// Workspaces of the organization, counted like the quota check on create.
export const workspaceCount = (ctx: TenantContext) =>
  withTenant(ctx, (tx) => countIn(tx, ctx.organizationId));

async function pruneWorkspaceIds(organizationId: string, id: string) {
  const drop = (col: typeof memberships.workspaceIds | typeof apiKeys.workspaceIds) => ({
    set: sql`array_remove(${col}, ${id}::uuid)`,
    has: sql`${id}::uuid = any (${col})`,
  });
  const m = drop(memberships.workspaceIds);
  await db
    .update(memberships)
    .set({ workspaceIds: m.set })
    .where(and(eq(memberships.organizationId, organizationId), m.has));
  const k = drop(apiKeys.workspaceIds);
  await db
    .update(apiKeys)
    .set({ workspaceIds: k.set })
    .where(and(eq(apiKeys.organizationId, organizationId), k.has));
}

// Strict definition lint enabled for the workspace (no secret decryption).
export async function lintStrict(ctx: TenantContext) {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId)),
  );
  return settingsSchema.parse(row?.settings ?? {}).lintStrict;
}

export const workspacesService = {
  // Settings: owners/admins; the audit only keeps secret names.
  setSettings: async (ctx: TenantContext, input: unknown) => {
    await requireScope(ctx, "admin");
    const { secrets = {}, ...patch } = settingsPatchSchema.parse(input);
    return withTenant(ctx, async (tx) => {
      // Secrets: encrypted in the vault, never in `settings`.
      for (const [name, value] of Object.entries(secrets))
        await putSecret(tx, ctx, name, value);
      // Merge with the stored settings: other keys (e.g. `ai`) are kept.
      const [row] = await tx
        .select({ settings: workspaces.settings })
        .from(workspaces)
        .where(eq(workspaces.id, ctx.workspaceId))
        .for("update");
      const current = isObject(row?.settings) ? row.settings : {};
      await tx
        .update(workspaces)
        .set({ settings: { ...mergeSettings(current, patch), secrets: {} } })
        .where(eq(workspaces.id, ctx.workspaceId));
      await audit(tx, ctx, "workspace.settings", ws(ctx.workspaceId), {
        ...(patch.allowedDomains && { allowedDomains: patch.allowedDomains }),
        secrets: Object.keys(secrets),
        ...(patch.mcpServers && { mcpServers: Object.keys(patch.mcpServers) }),
        ...(patch.lintStrict !== undefined && { lintStrict: patch.lintStrict }),
      });
    });
  },

  // An API key only sees and modifies its workspaces (RLS key_workspaces);
  // a user only those of their membership (workspace_ids, null = all).
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const member =
      "userId" in ctx.actor
        ? sql`exists (select 1 from memberships m
            where m.user_id = ${ctx.actor.userId}
            and m.organization_id = ${workspaces.organizationId}
            and m.accepted_at is not null
            and (m.workspace_ids is null or ${workspaces.id} = any (m.workspace_ids)))`
        : undefined;
    return withTenant(ctx, (tx) =>
      tx.select().from(workspaces).where(member).orderBy(workspaces.createdAt),
    );
  },
  // Creation, renaming and deletion: owners/admins (or admin key) only.
  create: async (ctx: TenantContext, name: string) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      const id = crypto.randomUUID();
      // API key: the new workspace joins its allowed workspaces.
      if ("apiKeyId" in ctx.actor) {
        const [k] = await tx
          .update(apiKeys)
          .set({
            workspaceIds: sql`array_append(${apiKeys.workspaceIds}, ${id}::uuid)`,
          })
          .where(eq(apiKeys.id, ctx.actor.apiKeyId))
          .returning({ ids: apiKeys.workspaceIds });
        await tx.execute(
          sql`select set_config('app.ws_ids', ${k!.ids.join(",")}, true)`,
        );
      }
      const n = await countIn(tx, ctx.organizationId);
      await checkQuota(ctx, "quota:workspaces", n + 1);
      const [row] = await tx
        .insert(workspaces)
        .values({ id, organizationId: ctx.organizationId, name })
        .returning();
      await audit(tx, ctx, "workspace.create", ws(row!.id), { name });
      return row!;
    }).finally(invalidateWorkspaceAccess);
  },
  rename: async (ctx: TenantContext, id: string, name: string) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      const [before] = await tx
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, id));
      const rows = await tx
        .update(workspaces)
        .set({ name })
        .where(eq(workspaces.id, id))
        .returning();
      if (rows.length)
        await audit(tx, ctx, "workspace.rename", ws(id), {
          name: [before?.name, name],
        });
      return rows;
    }).finally(invalidateWorkspaceAccess);
  },
  remove: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "admin");
    return withTenant(ctx, async (tx) => {
      // An organization always keeps at least one workspace.
      const all = await tx.select({ id: workspaces.id }).from(workspaces);
      if (all.length <= 1) throw appError(
          "workspaces.lastNotDeletable",
          "The last workspace cannot be deleted",
        );
      const rows = await tx
        .delete(workspaces)
        .where(eq(workspaces.id, id))
        .returning();
      if (rows.length)
        await audit(tx, ctx, "workspace.delete", ws(id), rows[0]);
      return rows;
    })
      .then(async (rows) => {
        // No dangling ids: members and API keys of the organization lose the
        // deleted workspace. Outside RLS (an admin key does not see every key),
        // limited to the organization; idempotent.
        if (rows.length) await pruneWorkspaceIds(ctx.organizationId, id);
        return rows;
      })
      .finally(invalidateWorkspaceAccess);
  },
};
