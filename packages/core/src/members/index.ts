// Organization members: invitation, list, role, removal,
// acceptance. The invitation stays pending (acceptedAt null, no access)
// until the invitee accepts it once signed in. The email goes through
// the sending interface (simulated by default, see email/).
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { requireScope, roleScope } from "../api-keys";
import { appError, forbidden, notFound } from "../errors/app-error";
import { audit } from "../audit";
import { db } from "../db/client";
import { emailSender } from "../email";
import { memberships, organizations, user } from "../db/schema";
import {
  invalidateWorkspaceAccess,
  withTenant,
  type TenantContext,
} from "../tenant";
import { appUrl } from "../env";

export type Role = keyof typeof roleScope;
// Assignable roles: owner stays with the organization creator.
export const ASSIGNABLE_ROLES = [
  "admin",
  "member",
  "viewer",
  "end_user",
] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

// Only owner/admin (or an admin key) manage members: role -> admin scope.
const requireOrgAdmin = (ctx: TenantContext) => requireScope(ctx, "admin");
const res = (id: string) => ({ type: "membership", id });

// Role of the session user (null for an API key or a non-member).
export async function roleOf(ctx: TenantContext): Promise<Role | null> {
  if (!("userId" in ctx.actor)) return null;
  const userId = ctx.actor.userId;
  const [m] = await withTenant(ctx, (tx) =>
    tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(eq(memberships.userId, userId), isNotNull(memberships.acceptedAt)),
      ),
  );
  return m?.role ?? null;
}

export const membersService = {
  invite: async (
    ctx: TenantContext,
    input: { email: string; role?: AssignableRole },
  ) => {
    await requireOrgAdmin(ctx);
    const email = input.email.trim().toLowerCase();
    const role = input.role ?? "member";
    if (!ASSIGNABLE_ROLES.includes(role))
      throw appError("members.unknownRole", "Unknown role: {role}", { role }, {
        kind: "invalid_input",
      });
    // user table outside RLS: direct insert, without a personal organization.
    await db
      .insert(user)
      .values({ id: crypto.randomUUID(), name: email, email })
      .onConflictDoNothing({ target: user.email });
    const [u] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    const row = await withTenant(ctx, async (tx) => {
      const [m] = await tx
        .insert(memberships)
        .values({
          userId: u!.id,
          organizationId: ctx.organizationId,
          role,
          acceptedAt: null,
        })
        .onConflictDoNothing()
        .returning();
      if (m) await audit(tx, ctx, "member.invite", res(m.id), { email, role });
      return m;
    });
    if (row) {
      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, ctx.organizationId));
      await emailSender().send({
        to: [email],
        subject: `Invitation to join ${org?.name ?? "an organization"}`,
        text:
          `You have been invited to join ${org?.name ?? "an organization"}.\n\n` +
          `Sign in with this address (a sign-in link will be sent to you), then accept the invitation: ${appUrl()}/login?next=/invitations\n`,
      });
    }
    return row ?? null;
  },

  // Members and pending invitations, with name and email.
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select({
          id: memberships.id,
          userId: memberships.userId,
          role: memberships.role,
          acceptedAt: memberships.acceptedAt,
          createdAt: memberships.createdAt,
        })
        .from(memberships)
        .orderBy(memberships.createdAt),
    );
    // user table outside RLS: read only for the members listed above.
    const users = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .innerJoin(memberships, eq(memberships.userId, user.id))
      .where(eq(memberships.organizationId, ctx.organizationId));
    return rows.map((m) => {
      const u = users.find((x) => x.id === m.userId);
      return {
        ...m,
        name: u?.name ?? "",
        email: u?.email ?? "",
        pending: !m.acceptedAt,
      };
    });
  },

  setRole: async (ctx: TenantContext, id: string, role: AssignableRole) => {
    await requireOrgAdmin(ctx);
    if (!ASSIGNABLE_ROLES.includes(role))
      throw appError("members.unknownRole", "Unknown role: {role}", { role }, {
        kind: "invalid_input",
      });
    return withTenant(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.id, id));
      if (!before) throw notFound("members.notFound", "Member not found");
      if (before.role === "owner")
        throw forbidden(
          "members.ownerRoleLocked",
          "The owner's role cannot be changed",
        );
      const [row] = await tx
        .update(memberships)
        .set({ role })
        .where(eq(memberships.id, id))
        .returning();
      await audit(tx, ctx, "member.role", res(id), {
        role: [before.role, role],
      });
      return row!;
    }).finally(invalidateWorkspaceAccess);
  },

  // Removes a member or cancels an invitation. The owner stays.
  remove: async (ctx: TenantContext, id: string) => {
    await requireOrgAdmin(ctx);
    return withTenant(ctx, async (tx) => {
      const [m] = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.id, id));
      if (!m) throw notFound("members.notFound", "Member not found");
      if (m.role === "owner")
        throw forbidden("members.ownerNotRemovable", "The owner cannot be removed");
      await tx.delete(memberships).where(eq(memberships.id, id));
      await audit(tx, ctx, "member.remove", res(id), { userId: m.userId });
      return { removed: true };
    }).finally(invalidateWorkspaceAccess);
  },
};

// Pending invitations of a user (outside RLS: they have no
// access to these organizations yet), and acceptance or refusal by them only.
export async function pendingInvitations(userId: string) {
  return db
    .select({
      organizationId: memberships.organizationId,
      organization: organizations.name,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.acceptedAt)));
}

export async function answerInvitation(
  userId: string,
  organizationId: string,
  accept: boolean,
) {
  const mine = and(
    eq(memberships.userId, userId),
    eq(memberships.organizationId, organizationId),
    isNull(memberships.acceptedAt),
  );
  if (accept) {
    // An unverified address may not be the invitee's: refuse acceptance.
    const [u] = await db
      .select({ verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId));
    if (!u?.verified)
      throw appError(
        "members.emailNotVerified",
        "Verify your email address before accepting the invitation",
        {},
        { kind: "forbidden" },
      );
  }
  const rows = accept
    ? await db
        .update(memberships)
        .set({ acceptedAt: new Date() })
        .where(mine)
        .returning({ id: memberships.id })
    : await db
        .delete(memberships)
        .where(mine)
        .returning({ id: memberships.id });
  if (!rows.length) throw notFound("members.invitationNotFound", "Invitation not found");
  invalidateWorkspaceAccess();
  return { accepted: accept };
}

// Owner of at least one organization: Bull Board guard.
export async function isOwner(userId: string) {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")))
    .limit(1);
  return !!row;
}
