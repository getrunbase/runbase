import type { LucideIcon } from "lucide-react";
import type { FlowNodeKind } from "@/components/ds/flow";
import type { WorkflowsT } from "../labels";
import { metaOf } from "./block-picker";

// Outside canvas.tsx: the editor uses it without loading React Flow.
// Node type by block: colour, icon and label from the board.
export function kindOf(
  type: string,
  t: WorkflowsT,
): { kind: FlowNodeKind; kindLabel: string; icon: LucideIcon } {
  const [category, icon] = metaOf(type);
  if (type === "condition" || type === "switch")
    return { kind: "condition", kindLabel: t("canvas.kind.condition"), icon };
  if (type === "human.approve")
    return { kind: "approval", kindLabel: t("canvas.kind.approval"), icon };
  if (category === "ai")
    return { kind: "ai", kindLabel: t("blocks.category.ai"), icon };
  if (category === "data")
    return { kind: "action", kindLabel: t("blocks.category.data"), icon };
  return { kind: "action", kindLabel: t("canvas.kind.action"), icon };
}
