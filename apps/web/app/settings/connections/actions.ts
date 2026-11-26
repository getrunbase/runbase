"use server";

import { revalidatePath } from "next/cache";
import { connectionsService } from "@getrunbase/core/connections";
import { actionError, type ActionError, runAction } from "@/lib/action-error";
import { formInput, parseInput } from "@/lib/action-input";
import { getTenant } from "@/lib/tenant";
import { connectInput, idInput } from "./inputs";

// Start of the OAuth flow: the client navigates to the returned URL.
export async function connect(
  f: FormData,
): Promise<{ url: string } | { error: ActionError }> {
  try {
    const { ctx } = await getTenant();
    const { provider, name, popup } = parseInput(connectInput, formInput(f));
    return {
      url: await connectionsService.authorizeUrl(ctx, provider, name, {
        popup: popup === "1",
      }),
    };
  } catch (e) {
    return { error: actionError(e) };
  }
}

export async function removeConnection(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { id } = parseInput(idInput, formInput(f));
    await connectionsService.remove(ctx, id);
    revalidatePath("/settings/connections");
  });
}
