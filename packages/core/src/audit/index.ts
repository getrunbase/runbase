// Audit log. Each mutation calls audit() in its withTenant
// transaction: the entry is written with the context actor (user or API key),
// whether it comes from the UI or MCP.
import { and, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import { requireScope } from "../api-keys";
import { auditLog } from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../tenant";

export async function audit(
  tx: Tx,
  ctx: TenantContext,
  action: string,
  resource: { type: string; id: string },
  diff?: unknown,
) {
  const a = ctx.actor;
  await tx.insert(auditLog).values({
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    actorUserId: "userId" in a ? a.userId : null,
    actorApiKeyId: "apiKeyId" in a ? a.apiKeyId : null,
    action,
    resourceType: resource.type,
    resourceId: resource.id,
    diff: diff ?? null,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuditFilter = {
  resourceType?: string;
  resourceId?: string;
  // Exact action (`record.update`) or prefix ending with `.` (`record.`).
  action?: string;
  actorUserId?: string;
  actorApiKeyId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
};

export const auditService = {
  // Workspace audit feed (most recent first), filtered, cursor-paginated.
  list: async (ctx: TenantContext, f: AuditFilter = {}) => {
    await requireScope(ctx, "read");
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.workspaceId, ctx.workspaceId),
            f.resourceType
              ? eq(auditLog.resourceType, f.resourceType)
              : undefined,
            f.resourceId ? eq(auditLog.resourceId, f.resourceId) : undefined,
            f.action
              ? f.action.endsWith(".")
                ? like(auditLog.action, `${f.action}%`)
                : eq(auditLog.action, f.action)
              : undefined,
            f.actorUserId ? eq(auditLog.actorUserId, f.actorUserId) : undefined,
            f.actorApiKeyId && UUID.test(f.actorApiKeyId)
              ? eq(auditLog.actorApiKeyId, f.actorApiKeyId)
              : undefined,
            f.from ? gte(auditLog.createdAt, f.from) : undefined,
            f.to ? lte(auditLog.createdAt, f.to) : undefined,
            f.cursor && UUID.test(f.cursor)
              ? sql`(${auditLog.createdAt}, ${auditLog.id}) < (select created_at, id from audit_log where id = ${f.cursor})`
              : undefined,
          ),
        )
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(limit + 1),
    );
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      items,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  },
  // History of a resource: who, what, when (most recent first).
  history: async (
    ctx: TenantContext,
    resource: { type: string; id: string },
  ) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.resourceType, resource.type),
            eq(auditLog.resourceId, resource.id),
          ),
        )
        .orderBy(desc(auditLog.createdAt)),
    );
  },
};
