"use server";

import { z } from "zod";
import { formInput, id as idSchema, parseInput } from "@/lib/action-input";
import { revalidatePath } from "next/cache";
import { runsService } from "@runbase/core/runs";
import { getTenant } from "@/lib/tenant";

// human.approve decision: the run resumes on approved / rejected.
export async function decideRun(f: FormData) {
  const { ctx } = await getTenant();
  const { id, decision } = parseInput(
    z.object({ id: idSchema, decision: z.enum(["approve", "reject"]) }),
    formInput(f),
  );
  await runsService.decide(ctx, id, decision === "approve");
  revalidatePath("/approvals");
  revalidatePath("/");
  revalidatePath("/runs", "layout");
}
