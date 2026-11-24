import { z } from "zod";
import { defineBlock } from "../block";
import { appError, notFound } from "../../errors/app-error";

// Maximum nesting depth of sub-workflows (A starts B which starts C…).
export const MAX_SUBWORKFLOW_DEPTH = 5;

// Starts another workflow of the workspace (id or name). `wait` (default): the run
// waits for the sub-workflow to end, branch ok (succeeded) or error, output =
// last output of the sub-workflow. Otherwise it continues right away (fire-and-forget).
export const workflowRun = defineBlock({
  type: "workflow.run",
  label: "Run another workflow",
  description:
    "Runs another workflow and waits for its result, or continues without waiting.",
  sideEffect: true,
  inputSchema: z.object({
    workflow: z.string().min(1),
    recordId: z.string().nullish(),
    // Payload passed to the sub-workflow as `{{event.…}}`.
    event: z.unknown().optional(),
    wait: z.boolean().default(true),
  }),
  outputSchema: z.object({
    runId: z.string(),
    status: z.string().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  }),
  branches: ["ok", "error"],
  run: async ({ workflow, recordId, event, wait }, ctx) => {
    if (ctx.depth + 1 > MAX_SUBWORKFLOW_DEPTH)
      throw appError(
        "blocks.maxDepth",
        "Maximum sub-workflow depth reached ({max})",
        { max: MAX_SUBWORKFLOW_DEPTH },
      );
    if (!ctx.tenant || !ctx.engine)
      throw appError(
        "blocks.runContextRequired",
        "workflow.run: run context required",
      );
    const child = await ctx.engine.startWorkflow(workflow, {
      recordId: recordId ?? undefined,
      event,
      depth: ctx.depth + 1,
      ...(wait && ctx.run && { parent: ctx.run }),
      ...(ctx.key && { idempotencyKey: `sub:${ctx.key}` }),
    });
    if (!child)
      throw notFound("blocks.unknownWorkflow", "Unknown workflow: {workflow}", {
        workflow,
      });
    // No wait, or empty sub-workflow already finished.
    if (!wait || !ctx.run || child.status === "succeeded")
      return {
        branch: "ok",
        output: { runId: child.id, status: child.status },
      };
    return { branch: "", output: { runId: child.id }, pause: true };
  },
});
