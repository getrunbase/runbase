import { notFound } from "@getrunbase/core/errors";
import { runsService } from "@getrunbase/core/runs";
import { route } from "@/lib/api-v1/http";

export const GET = route("getRun", async ({ ctx, params }) => {
  const run = await runsService.get(ctx, params.id);
  if (!run)
    throw notFound("api.runNotFound", "Run {id} not found", { id: params.id });
  return run;
});
