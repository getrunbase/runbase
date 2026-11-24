"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runsService } from "@runbase/core/runs";
import { actionError } from "@/lib/action-error";
import { formInput, id, parseInput } from "@/lib/action-input";
import { getTenant } from "@/lib/tenant";

const controlInput = z.object({
  id,
  action: z.enum(["pause", "resume", "cancel", "retry_from", "replay"]),
  step: z.string().max(200).optional(),
});

// Run control from its detail page: pause, resume, cancel, retry.
// A refusal (another active run on the record…) is shown on the page:
// the serialized error travels in the URL, translated by the page.
export async function controlRun(f: FormData) {
  const { ctx } = await getTenant();
  const runId = String(f.get("id") ?? "");
  let replayed: string | undefined;
  try {
    const { id, action, step } = parseInput(controlInput, formInput(f));
    if (action === "pause") await runsService.pause(ctx, id);
    if (action === "resume") await runsService.resume(ctx, id);
    if (action === "cancel") await runsService.cancel(ctx, id);
    if (action === "retry_from")
      await runsService.retryFrom(ctx, id, step ?? "");
    if (action === "replay") replayed = (await runsService.replay(ctx, id))?.id;
  } catch (e) {
    const { code, params, message } = actionError(e);
    redirect(
      `/runs/${encodeURIComponent(runId)}?erreur=${encodeURIComponent(
        JSON.stringify({ code, params, message }),
      )}`,
    );
  }
  revalidatePath("/runs", "layout");
  if (replayed) redirect(`/runs/${replayed}`);
  redirect(`/runs/${encodeURIComponent(runId)}`);
}
