"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@runbase/core/auth";
import {
  answerInvitation,
  ASSIGNABLE_ROLES,
  membersService,
  type AssignableRole,
} from "@runbase/core/members";
import { quotasService } from "@runbase/core/quotas";
import { workspacesService } from "@runbase/core/workspaces";
import { runsService } from "@runbase/core/runs";
import { getTenant, WORKSPACE_COOKIE } from "@/lib/tenant";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function switchWorkspace(f: FormData) {
  const { ctx } = await getTenant();
  const id = str(f, "id");
  // Keeps only visible workspaces (RLS).
  if ((await workspacesService.list(ctx)).some((w) => w.id === id))
    (await cookies()).set(WORKSPACE_COOKIE, id);
  revalidatePath("/", "layout");
}

export async function createWorkspace(f: FormData) {
  const { ctx } = await getTenant();
  if (str(f, "name")) await workspacesService.create(ctx, str(f, "name"));
  revalidatePath("/", "layout");
}

export async function renameWorkspace(f: FormData) {
  const { ctx } = await getTenant();
  if (str(f, "name"))
    await workspacesService.rename(ctx, str(f, "id"), str(f, "name"));
  revalidatePath("/", "layout");
}

export async function deleteWorkspace(f: FormData) {
  const { ctx } = await getTenant();
  await workspacesService.remove(ctx, str(f, "id"));
  revalidatePath("/", "layout");
}

const roleOf = (f: FormData): AssignableRole => {
  const r = str(f, "role") as AssignableRole;
  return ASSIGNABLE_ROLES.includes(r) ? r : "member";
};

export async function inviteMember(f: FormData) {
  const { ctx } = await getTenant();
  if (str(f, "email"))
    await membersService.invite(ctx, {
      email: str(f, "email"),
      role: roleOf(f),
    });
  revalidatePath("/settings/members");
}

export async function setMemberRole(f: FormData) {
  const { ctx } = await getTenant();
  await membersService.setRole(ctx, str(f, "id"), roleOf(f));
  revalidatePath("/settings/members");
}

export async function removeMember(f: FormData) {
  const { ctx } = await getTenant();
  await membersService.remove(ctx, str(f, "id"));
  revalidatePath("/settings/members");
}

// Workspace quotas: empty field = default value.
export async function setLimits(f: FormData) {
  const { ctx } = await getTenant();
  const n = (k: string) => (str(f, k) ? Number(str(f, k)) : undefined);
  await quotasService.set(ctx, {
    records: n("records"),
    runsPerMinute: n("runsPerMinute"),
    apiPerMinute: n("apiPerMinute"),
    concurrency: n("concurrency"),
  });
  revalidatePath("/settings/general");
}

// Answer to an invitation, by the invitee themselves.
export async function answerInvite(f: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  await answerInvitation(
    session.user.id,
    str(f, "organizationId"),
    str(f, "accept") === "1",
  );
  revalidatePath("/", "layout");
  redirect(str(f, "accept") === "1" ? "/" : "/invitations");
}

// Monthly AI budget: empty = unlimited.
export async function setAiBudget(f: FormData) {
  const { ctx } = await getTenant();
  const v = str(f, "budget");
  await runsService.setBudget(ctx, v ? Number(v) : null);
  revalidatePath("/", "layout");
}

// Workspace switch from the selector.
export async function switchWorkspaceTo(id: string) {
  const f = new FormData();
  f.set("id", id);
  await switchWorkspace(f);
}
