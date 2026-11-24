"use server";

import { z } from "zod";
import { formInput, id, parseInput } from "@/lib/action-input";
import { revalidatePath } from "next/cache";
import { errorsService } from "@runbase/core/errors";
import { getTenant } from "@/lib/tenant";

// Error center: replay and resolution.
const idInput = z.object({ id });

export async function retryError(f: FormData) {
  const { ctx } = await getTenant();
  const { id } = parseInput(idInput, formInput(f));
  await errorsService.retry(ctx, id);
  revalidatePath("/", "layout");
}

export async function resolveError(f: FormData) {
  const { ctx } = await getTenant();
  const { id } = parseInput(idInput, formInput(f));
  await errorsService.resolve(ctx, id);
  revalidatePath("/", "layout");
}
