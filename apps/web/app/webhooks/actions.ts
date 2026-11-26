"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { appError } from "@getrunbase/core/app-error";
import { webhooksService } from "@getrunbase/core/webhooks";
import { actionError, type ActionError, runAction } from "@/lib/action-error";
import { formInput, id, parseInput, trimmed } from "@/lib/action-input";
import { getTenant } from "@/lib/tenant";

export type FormState = { error?: ActionError; ok?: boolean };

const createInput = z.object({
  name: trimmed.min(1).max(200),
  eventType: trimmed.min(1).max(200),
  secretName: trimmed.max(200),
  format: trimmed.max(50),
  header: trimmed.max(200).optional(),
});
const testInput = z.object({
  id,
  payload: trimmed.max(1_000_000).optional(),
});
const idInput = z.object({ id });

export async function createWebhook(
  _: FormState,
  f: FormData,
): Promise<FormState> {
  const { ctx } = await getTenant();
  try {
    const { format, header, ...rest } = parseInput(createInput, formInput(f));
    await webhooksService.create(ctx, {
      ...rest,
      config: (format === "hmac"
        ? { format, header: header || "x-signature" }
        : { format }) as never,
    });
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidatePath("/webhooks");
  return { ok: true };
}

export async function testWebhook(
  _: FormState,
  f: FormData,
): Promise<FormState> {
  const { ctx } = await getTenant();
  try {
    const input = parseInput(testInput, formInput(f));
    let payload: unknown;
    try {
      payload = JSON.parse(input.payload || "{}");
    } catch {
      throw appError("webhooks.invalidJson", "Invalid JSON payload");
    }
    const r = await webhooksService.sendTest(ctx, input.id, payload);
    if (r.status !== 200)
      return {
        error: actionError(
          appError("webhooks.testFailed", "Test failed: {detail}", {
            detail: (r.body as { error?: string }).error ?? String(r.status),
          }),
        ),
      };
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidatePath("/webhooks");
  return { ok: true };
}

export async function clearWebhookSample(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { id } = parseInput(idInput, formInput(f));
    await webhooksService.clearSample(ctx, id);
    revalidatePath("/webhooks");
  });
}

export async function deleteWebhook(f: FormData) {
  return runAction(async () => {
    const { ctx } = await getTenant();
    const { id } = parseInput(idInput, formInput(f));
    await webhooksService.remove(ctx, id);
    revalidatePath("/webhooks");
  });
}
