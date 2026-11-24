"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@runbase/core/app-error";
import { workflowsService } from "@runbase/core/workflows";
import { actionError, type ActionError } from "@/lib/action-error";
import { getTenant } from "@/lib/tenant";
import type { Definition } from "./graph";

// Error -> translatable items; invalid workflow: one line per error.
const errorsOf = (e: unknown): ActionError[] =>
  e instanceof AppError && e.items.length ? e.items : [actionError(e)];

// Workflow editor: creation, save, validation, dry run, activation.
export async function createWorkflow(f: FormData) {
  const { ctx } = await getTenant();
  const wf = await workflowsService.create(ctx, {
    name: String(f.get("name")),
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
    await workflowsService.update(ctx, id, { name, definition });
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
    return await workflowsService.validateItems(ctx, definition);
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
    return {
      results: await workflowsService.dryRun(ctx, definition, recordIds),
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
    await workflowsService.update(ctx, id, { status });
    revalidatePath(`/workflows/${id}`);
    return {};
  } catch (e) {
    return { errors: errorsOf(e) };
  }
}

// Last payload received by a webhook (listening for a provider test).
export async function webhookSample(name: string) {
  const { ctx } = await getTenant();
  const { webhooksService } = await import("@runbase/core/webhooks");
  const w = (await webhooksService.list(ctx)).find((x) => x.name === name);
  return w ? { sample: w.sample, at: w.sampleAt?.toISOString() ?? null } : null;
}

// History and restore (new version copying the old one).
export async function workflowHistory(id: string) {
  const { ctx } = await getTenant();
  return (await workflowsService.versions(ctx, id)).map((v) => ({
    version: v.version,
    createdAt: v.createdAt,
  }));
}
export async function restoreWorkflow(id: string, version: number) {
  const { ctx } = await getTenant();
  await workflowsService.restore(ctx, id, version);
  revalidatePath(`/workflows/${id}`);
}
