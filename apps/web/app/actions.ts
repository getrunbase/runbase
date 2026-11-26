"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@getrunbase/core/auth";
import { answerInvitation, membersService } from "@getrunbase/core/members";
import { quotasService } from "@getrunbase/core/quotas";
import { workspacesService } from "@getrunbase/core/workspaces";
import { runsService } from "@getrunbase/core/runs";
import { formInput, parseInput } from "@/lib/action-input";
import { getTenant, WORKSPACE_COOKIE } from "@/lib/tenant";
import { actionError, runAction, type ActionError } from "@/lib/action-error";
import {
  answerInput,
  budgetInput,
  idInput,
  inviteInput,
  limitsInput,
  nameInput,
  renameInput,
  roleInput,
} from "./inputs";

export async function switchWorkspace(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { id } = parseInput(idInput, formInput(f));
    // Keeps only visible workspaces (RLS).
    if ((await workspacesService.list(ctx)).some((w) => w.id === id))
      (await cookies()).set(WORKSPACE_COOKIE, id);
    revalidatePath("/", "layout");
  });
}

// Returns the error (quota reached, ...) instead of throwing: a thrown
// error in a server action renders the generic error page.
export async function createWorkspace(
  _: { error?: ActionError; ok?: boolean } | undefined,
  f: FormData,
) {
  try {
    const { ctx } = await getTenant();
    const { name } = parseInput(nameInput, formInput(f));
    if (name) await workspacesService.create(ctx, name);
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameWorkspace(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { id, name } = parseInput(renameInput, formInput(f));
    if (name) await workspacesService.rename(ctx, id, name);
    revalidatePath("/", "layout");
  });
}

export async function deleteWorkspace(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { id } = parseInput(idInput, formInput(f));
    await workspacesService.remove(ctx, id);
    revalidatePath("/", "layout");
  });
}

export async function inviteMember(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { email, role } = parseInput(inviteInput, formInput(f));
    if (email) await membersService.invite(ctx, { email, role });
    revalidatePath("/settings/members");
  });
}

export async function setMemberRole(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { id, role } = parseInput(roleInput, formInput(f));
    await membersService.setRole(ctx, id, role);
    revalidatePath("/settings/members");
  });
}

export async function removeMember(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { id } = parseInput(idInput, formInput(f));
    await membersService.remove(ctx, id);
    revalidatePath("/settings/members");
  });
}

// Workspace quotas: empty field = default value.
export async function setLimits(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    await quotasService.set(ctx, parseInput(limitsInput, formInput(f)));
    revalidatePath("/settings/general");
  });
}

// Answer to an invitation, by the invitee themselves.
export async function answerInvite(f: FormData) {
  return runAction(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) redirect("/login");
    const { organizationId, accept } = parseInput(answerInput, formInput(f));
    await answerInvitation(session.user.id, organizationId, accept);
    revalidatePath("/", "layout");
    redirect(accept ? "/" : "/invitations");
  });
}

// Monthly AI budget: empty = unlimited.
export async function setAiBudget(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { budget } = parseInput(budgetInput, formInput(f));
    await runsService.setBudget(ctx, budget);
    revalidatePath("/", "layout");
  });
}

// Workspace switch from the selector.
export async function switchWorkspaceTo(id: string) {
  const f = new FormData();
  f.set("id", id);
  return switchWorkspace(f);
}
