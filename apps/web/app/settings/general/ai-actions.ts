"use server";

import { revalidatePath } from "next/cache";
import { aiSettingsService } from "@getrunbase/core/ai-providers";
import { getTenant } from "@/lib/tenant";
import { actionError, type ActionError } from "@/lib/action-error";

// Workspace AI provider: empty key = unchanged.
export async function setAiProvider(
  _: { error?: ActionError; ok?: boolean } | undefined,
  f: FormData,
) {
  try {
    const { ctx } = await getTenant();
    await aiSettingsService.set(ctx, {
      provider: String(f.get("provider") ?? ""),
      model: String(f.get("model") ?? ""),
      keySecret: String(f.get("keySecret") ?? ""),
      key: String(f.get("key") ?? ""),
    });
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidatePath("/settings/general");
  return { ok: true };
}
