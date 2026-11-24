import { notFound } from "@runbase/core/errors";
import { runsService } from "@runbase/core/runs";
import { route } from "@/lib/api-v1/http";

export const GET = route("listRuns", async ({ ctx, query }) => {
  const { after, ...filter } = query;
  const page = await runsService.list(ctx, { ...filter, cursor: after });
  return { data: page.items, next: page.nextCursor };
});

export const POST = route("startRun", async ({ ctx, body }) => {
  const { workflowId, ...opts } = body;
  const run = await runsService.start(ctx, workflowId, opts);
  if (!run)
    throw notFound("api.workflowNotFound", "Workflow {id} not found", {
      id: workflowId,
    });
  return run;
});
