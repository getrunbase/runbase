"use server";

import { revalidatePath } from "next/cache";
import { apiKeysService } from "@runbase/core/api-keys";
import type { Scope } from "@runbase/core/tenant";
import { z } from "zod";
import { actionError, type ActionError } from "@/lib/action-error";
import { formInput, list, parseInput, trimmed, uuid } from "@/lib/action-input";
import { getTenant } from "@/lib/tenant";

export type CreateResult = { key?: string; error?: ActionError };

const createInput = z.object({
  name: trimmed.min(1).max(200),
  scopes: list.pipe(z.array(z.enum(["read", "write", "admin"])).min(1)),
  workspaceIds: list.pipe(z.array(uuid)),
  objects: list,
  tools: trimmed
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
});

// API keys: the plaintext key is returned only here, once.
export async function createApiKey(
  _: CreateResult | null,
  f: FormData,
): Promise<CreateResult> {
  const { ctx } = await getTenant();
  try {
    const input = parseInput(createInput, formInput(f));
    const { key } = await apiKeysService.create(ctx, {
      ...input,
      scopes: input.scopes as Scope[],
    });
    revalidatePath("/settings/api-keys");
    return { key };
  } catch (e) {
    return { error: actionError(e) };
  }
}

export async function revokeApiKey(f: FormData) {
  const { ctx } = await getTenant();
  const { id } = parseInput(z.object({ id: uuid }), formInput(f));
  await apiKeysService.revoke(ctx, id);
  revalidatePath("/settings/api-keys");
}
