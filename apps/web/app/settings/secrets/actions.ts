"use server";

import { revalidatePath } from "next/cache";
import { secretsService } from "@runbase/core/secrets";
import { actionError, type ActionError } from "@/lib/action-error";
import { getTenant } from "@/lib/tenant";

// Secrets: add / delete, values never read back.
export async function setSecret(f: FormData) {
  const { ctx } = await getTenant();
  await secretsService.set(ctx, String(f.get("name")), String(f.get("value")));
  revalidatePath("/settings/secrets");
}

// Manual entry from a selector: only the name comes back.
export async function createSecret(
  f: FormData,
): Promise<{ name: string } | { error: ActionError }> {
  try {
    const { ctx } = await getTenant();
    const name = String(f.get("name") ?? "");
    await secretsService.set(ctx, name, String(f.get("value") ?? ""));
    revalidatePath("/settings/secrets");
    return { name };
  } catch (e) {
    return { error: actionError(e) };
  }
}

export async function removeSecret(f: FormData) {
  const { ctx } = await getTenant();
  await secretsService.remove(ctx, String(f.get("name")));
  revalidatePath("/settings/secrets");
}
