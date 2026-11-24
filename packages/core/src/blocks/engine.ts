// Builds the engine hooks handed to blocks (BlockEngine). Lives outside
// block.ts and the catalog: it imports the registry, which imports the catalog.
import { getBlock } from "./index";
import type { BlockEngine } from "./block";
import { appError } from "../errors/app-error";
import { stepInput } from "../runs/templates";
import type { TenantContext } from "../tenant";

// Without a starter (dry run), workflow.run cannot start a sub-workflow.
const noStart: BlockEngine["startWorkflow"] = async () => {
  throw appError(
    "blocks.subWorkflowUnavailable",
    "workflow.run: sub-workflows cannot start here",
  );
};

export function blockEngine(
  ctx: TenantContext,
  startWorkflow: BlockEngine["startWorkflow"] = noStart,
): BlockEngine {
  return {
    getBlock: (type) => getBlock(ctx, type),
    stepInput: (input, raw, scope) => stepInput(ctx, input, raw, scope),
    startWorkflow,
  };
}
