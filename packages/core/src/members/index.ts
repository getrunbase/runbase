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
import { memberships, organizations, user, workspaces } from "../db/schema";
import { anyUuid } from "../db/any";
import {
  invalidateWorkspaceAccess,
  withTenant,
  type TenantContext,
  type Tx,
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

// Owners and admins always access every workspace (workspaceIds null).
const ALL_WORKSPACE_ROLES: readonly Role[] = ["owner", "admin"];
export const accessesAllWorkspaces = (role: Role) =>
  ALL_WORKSPACE_ROLES.includes(role);

// Workspace access of a membership: null = all those of the organization.
export type WorkspaceAccess = string[] | null;

// Union of two accesses: "all" absorbs any list.
export const mergeAccess = (
  a: WorkspaceAccess,
  b: WorkspaceAccess,
): WorkspaceAccess => (a === null || b === null ? null : [...new Set([...a, ...b])]);

// Checks the ids against the organization's workspaces (RLS) and returns
// them with their names, in the requested order. Empty list refused.
async function orgWorkspaces(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length)
    throw appError(
      "members.noWorkspace",
      "Choose at least one workspace, or all workspaces",
      {},
      { kind: "invalid_input" },
    );
  const rows = await tx
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(anyUuid(workspaces.id, unique));
  if (rows.length !== unique.length)
    throw appError(
      "members.unknownWorkspace",
      "Unknown workspace in organization",
      {},
      { kind: "invalid_input" },
    );
  return unique.map((id) => rows.find((r) => r.id === id)!);
}

// Access to store for a role: owners/admins always null, the others an
// explicit, validated list (null only when "all workspaces" is chosen).
async function accessFor(tx: Tx, role: Role, ids: WorkspaceAccess) {
  if (accessesAllWorkspaces(role) || ids === null) return null;
  return (await orgWorkspaces(tx, ids)).map((w) => w.id);
}

// Workspace names for the emails ("all workspaces" when null).
async function workspaceNames(tx: Tx, ids: WorkspaceAccess) {
  if (ids === null) return "all workspaces";
  const rows = await orgWorkspaces(tx, ids);
  return rows.map((w) => w.name).join(", ");
}

const checkRole = (role: string) => {
  if (!ASSIGNABLE_ROLES.includes(role as AssignableRole))
    throw appError("members.unknownRole", "Unknown role: {role}", { role }, {
      kind: "invalid_input",
    });
};

const orgName = async (organizationId: string) => {
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return org?.name ?? "an organization";
};

export const membersService = {
  // Invitation scoped to workspaces. workspaceIds: explicit list, or null for
  // all workspaces (owners/admins: always null). A second invitation of the
  // same person merges the workspaces: pending, the role is updated and the
  // email resent; accepted, the role stays and a short access email goes out.
  invite: async (
    ctx: TenantContext,
    input: {
      email: string;
      role?: AssignableRole;
      workspaceIds: WorkspaceAccess;
    },
  ) => {
    await requireOrgAdmin(ctx);
    const email = input.email.trim().toLowerCase();
    if (input.role !== undefined) checkRole(input.role);
    // user table outside RLS: direct insert, without a personal organization.
    await db
      .insert(user)
      .values({ id: crypto.randomUUID(), name: email, email })
      .onConflictDoNothing({ target: user.email });
    const [u] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    const result = await withTenant(ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.userId, u!.id))
        .for("update");
      if (!existing) {
        const role = input.role ?? "member";
        const workspaceIds = await accessFor(tx, role, input.workspaceIds);
        const [m] = await tx
          .insert(memberships)
          .values({
            userId: u!.id,
            organizationId: ctx.organizationId,
            role,
            workspaceIds,
            acceptedAt: null,
          })
          .returning();
        await audit(tx, ctx, "member.invite", res(m!.id), {
          email,
          role,
          workspaceIds,
        });
        return { row: m!, kind: "invite" as const, added: workspaceIds };
      }
      const pending = !existing.acceptedAt;
      // Accepted member: the role changes only through setRole.
      const role =
        pending && input.role && existing.role !== "owner"
          ? input.role
          : existing.role;
      const requested = await accessFor(tx, role, input.workspaceIds);
      const workspaceIds = accessesAllWorkspaces(role)
        ? null
        : mergeAccess(existing.workspaceIds, requested);
      const [m] = await tx
        .update(memberships)
        .set({ role, workspaceIds })
        .where(eq(memberships.id, existing.id))
        .returning();
      await audit(tx, ctx, "member.invite_merge", res(existing.id), {
        email,
        ...(role !== existing.role && { role: [existing.role, role] }),
        workspaceIds: [existing.workspaceIds, workspaceIds],
      });
      return {
        row: m!,
        kind: pending ? ("invite" as const) : ("access" as const),
        added: requested,
      };
    }).finally(invalidateWorkspaceAccess);
    const org = await orgName(ctx.organizationId);
    const names = await withTenant(ctx, (tx) =>
      workspaceNames(tx, result.kind === "invite" ? result.row.workspaceIds : result.added),
    );
    await emailSender().send(
      result.kind === "invite"
        ? {
            to: [email],
            subject: `Invitation to join ${org}`,
            text:
              `You have been invited to join ${org} (workspaces: ${names}).\n\n` +
              `Sign in with this address (a sign-in link will be sent to you), then accept the invitation: ${appUrl()}/login?next=/invitations\n`,
          }
        : {
            to: [email],
            subject: `New access in ${org}`,
            text:
              `You now have access to ${names} in ${org}.\n\n` +
              `Open Runbase: ${appUrl()}/\n`,
          },
    );
    return result.row;
  },

  // Workspaces a member or invitee can open (owners/admins: all, null only).
  setWorkspaces: async (
    ctx: TenantContext,
    id: string,
    workspaceIds: WorkspaceAccess,
  ) => {
    await requireOrgAdmin(ctx);
    return withTenant(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.id, id));
      if (!before) throw notFound("members.notFound", "Member not found");
      if (accessesAllWorkspaces(before.role) && workspaceIds !== null)
        throw appError(
          "members.adminAllWorkspaces",
          "Owners and admins always access every workspace",
          {},
          { kind: "invalid_input" },
        );
      const ids = await accessFor(tx, before.role, workspaceIds);
      const [row] = await tx
        .update(memberships)
        .set({ workspaceIds: ids })
        .where(eq(memberships.id, id))
        .returning();
      await audit(tx, ctx, "member.workspaces", res(id), {
        workspaceIds: [before.workspaceIds, ids],
      });
      return row!;
    }).finally(invalidateWorkspaceAccess);
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
          workspaceIds: memberships.workspaceIds,
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
    checkRole(role);
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
        // Promoted to admin: access to every workspace.
        .set(accessesAllWorkspaces(role) ? { role, workspaceIds: null } : { role })
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
