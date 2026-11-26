"use server";

import { revalidatePath } from "next/cache";
import { secretsService } from "@getrunbase/core/secrets";
import { actionError, type ActionError, runAction } from "@/lib/action-error";
import { formInput, parseInput } from "@/lib/action-input";
import { getTenant } from "@/lib/tenant";
import { nameInput, setInput } from "./inputs";

// Secrets: add / delete, values never read back.
export async function setSecret(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { name, value } = parseInput(setInput, formInput(f));
    await secretsService.set(ctx, name, value);
    revalidatePath("/settings/secrets");
  });
}

// Manual entry from a selector: only the name comes back.
export async function createSecret(
  f: FormData,
): Promise<{ name: string } | { error: ActionError }> {
  try {
    const { ctx } = await getTenant();
    const { name, value } = parseInput(setInput, formInput(f));
    await secretsService.set(ctx, name, value);
    revalidatePath("/settings/secrets");
    return { name };
  } catch (e) {
    return { error: actionError(e) };
  }
}

export async function removeSecret(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { name } = parseInput(nameInput, formInput(f));
    await secretsService.remove(ctx, name);
    revalidatePath("/settings/secrets");
  });
}
