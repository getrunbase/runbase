"use server";

import { runAction } from "@/lib/action-error";
import { z } from "zod";
import { formInput, id, parseInput } from "@/lib/action-input";
import { revalidatePath } from "next/cache";
import { errorsService } from "@getrunbase/core/errors";
import { getTenant } from "@/lib/tenant";

// Error center: replay and resolution.
const idInput = z.object({ id });

export async function retryError(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { id } = parseInput(idInput, formInput(f));
    await errorsService.retry(ctx, id);
    revalidatePath("/", "layout");
  });
}

export async function resolveError(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { id } = parseInput(idInput, formInput(f));
    await errorsService.resolve(ctx, id);
    revalidatePath("/", "layout");
  });
}
