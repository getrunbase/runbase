// Agent product feedback (MCP): bugs, limits, ideas, usage.
// send goes through withTenant (RLS); list/resolve are reserved to platform
// admins (PLATFORM_ADMIN_EMAILS allowlist) and read outside the tenant.
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { feedback, organizations } from "../db/schema";
import { withTenant, type TenantContext } from "../tenant";
import { env } from "../env";

export const FEEDBACK_KINDS = ["bug", "limit", "idea", "usage"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const isPlatformAdmin = (email?: string | null) =>
  !!email && env().PLATFORM_ADMIN_EMAILS.includes(email.toLowerCase());

export const feedbackService = {
  send: (
    ctx: TenantContext,
    input: {
      kind: FeedbackKind;
      title: string;
      details: string;
      tool?: string;
      context?: unknown;
    },
  ) =>
    withTenant(ctx, async (tx) => {
      const a = ctx.actor;
      // No RETURNING: the tenant has no right to read back (insert-only RLS).
      const id = crypto.randomUUID();
      await tx.insert(feedback).values({
          id,
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          actorUserId: "userId" in a ? a.userId : null,
          actorApiKeyId: "apiKeyId" in a ? a.apiKeyId : null,
          ...input,
          context: input.context ?? null,
      });
      return { id, received: true };
    }),

  // ponytail: last 200, paginate when volume requires it.
  list: (f: { kind?: FeedbackKind; open?: boolean } = {}) =>
    db
      .select({ f: feedback, org: organizations.name })
      .from(feedback)
      .leftJoin(organizations, eq(organizations.id, feedback.organizationId))
      .where(
        and(
          f.kind ? eq(feedback.kind, f.kind) : undefined,
          f.open === undefined
            ? undefined
            : f.open
              ? isNull(feedback.resolvedAt)
              : isNotNull(feedback.resolvedAt),
        ),
      )
      .orderBy(desc(feedback.createdAt))
      .limit(200),

  resolve: (id: string, resolved: boolean) =>
    db
      .update(feedback)
      .set({ resolvedAt: resolved ? new Date() : null })
      .where(eq(feedback.id, id)),
};
