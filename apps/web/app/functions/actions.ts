"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { functionsService } from "@getrunbase/core/functions";
import { actionError, type ActionError, runAction } from "@/lib/action-error";
import { formInput, parseInput } from "@/lib/action-input";
import { getTenant } from "@/lib/tenant";
import { restoreInput, saveInput, testInput } from "./inputs";

// Functions: saving creates a version, so does restoring.
export async function saveFunction(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { domains, secrets, ...input } = parseInput(saveInput, formInput(f));
    const row = await functionsService.save(ctx, {
      ...input,
      permissions: { domains, secrets },
    });
    revalidatePath("/functions", "layout");
    redirect(`/functions/${row.name}`);
  });
}

export async function restoreFunction(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { name, version } = parseInput(restoreInput, formInput(f));
    await functionsService.restore(ctx, name, version);
    revalidatePath(`/functions/${name}`);
  });
}

export type TestResult = {
  output?: unknown;
  logs?: string;
  error?: ActionError;
};

// Test button: same service as the functions.test MCP tool.
export async function testFunction(
  _: TestResult | null,
  f: FormData,
): Promise<TestResult> {
  const { ctx } = await getTenant();
  try {
    const { name, input, version } = parseInput(testInput, formInput(f));
    return await functionsService.test(ctx, name, input, version);
  } catch (e) {
    return { error: actionError(e) };
  }
}
