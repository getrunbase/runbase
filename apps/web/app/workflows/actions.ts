"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@getrunbase/core/app-error";
import { workflowsService } from "@getrunbase/core/workflows";
import { actionError, type ActionError } from "@/lib/action-error";
import { formInput, parseInput } from "@/lib/action-input";
import { getTenant } from "@/lib/tenant";
import type { Definition } from "./graph";
import {
  createInput,
  definition as definitionInput,
  dryRunInput,
  nameInput,
  restoreInput,
  saveInput,
  statusInput,
} from "./inputs";

// Error -> translatable items; invalid workflow: one line per error.
const errorsOf = (e: unknown): ActionError[] =>
  e instanceof AppError && e.items.length ? e.items : [actionError(e)];

// Workflow editor: creation, save, validation, dry run, activation.
export async function createWorkflow(f: FormData) {
  const { ctx } = await getTenant();
  const { name } = parseInput(createInput, formInput(f));
  const wf = await workflowsService.create(ctx, {
    name,
    definition: { trigger: { type: "trigger.manual" }, steps: [] },
  });
  revalidatePath("/", "layout");
  redirect(`/workflows/${wf.id}`);
}

export async function saveWorkflow(
  id: string,
  name: string,
  definition: Definition,
): Promise<{ errors?: ActionError[] }> {
  const { ctx } = await getTenant();
  try {
    const input = parseInput(saveInput, { id, name, definition });
    await workflowsService.update(ctx, input.id, {
      name: input.name,
      definition: input.definition,
    });
    revalidatePath("/", "layout");
    return {};
  } catch (e) {
    return { errors: errorsOf(e) };
  }
}

export async function validateWorkflow(
  definition: Definition,
): Promise<ActionError[]> {
  const { ctx } = await getTenant();
  try {
    return await workflowsService.validateItems(
      ctx,
      parseInput(definitionInput, definition),
    );
  } catch (e) {
    return errorsOf(e);
  }
}

export async function dryRunWorkflow(
  definition: Definition,
  recordIds: string[],
) {
  const { ctx } = await getTenant();
  try {
    const input = parseInput(dryRunInput, { definition, recordIds });
    return {
      results: await workflowsService.dryRun(
        ctx,
        input.definition,
        input.recordIds,
      ),
    };
  } catch (e) {
    return { error: actionError(e) };
  }
}

export async function setStatus(
  id: string,
  status: "active" | "paused",
): Promise<{ errors?: ActionError[] }> {
  const { ctx } = await getTenant();
  try {
    const input = parseInput(statusInput, { id, status });
    await workflowsService.update(ctx, input.id, { status: input.status });
    revalidatePath(`/workflows/${input.id}`);
    return {};
  } catch (e) {
    return { errors: errorsOf(e) };
  }
}

// Last payload received by a webhook (listening for a provider test).
export async function webhookSample(name: string) {
  const { ctx } = await getTenant();
  const input = parseInput(nameInput, { name });
  const { webhooksService } = await import("@getrunbase/core/webhooks");
  const w = (await webhooksService.list(ctx)).find(
    (x) => x.name === input.name,
  );
  return w ? { sample: w.sample, at: w.sampleAt?.toISOString() ?? null } : null;
}

// History and restore (new version copying the old one).
export async function workflowHistory(id: string) {
  const { ctx } = await getTenant();
  const input = parseInput(restoreInput.pick({ id: true }), { id });
  return (await workflowsService.versions(ctx, input.id)).map((v) => ({
    version: v.version,
    createdAt: v.createdAt,
  }));
}
export async function restoreWorkflow(id: string, version: number) {
  const { ctx } = await getTenant();
  const input = parseInput(restoreInput, { id, version });
  await workflowsService.restore(ctx, input.id, input.version);
  revalidatePath(`/workflows/${input.id}`);
}
