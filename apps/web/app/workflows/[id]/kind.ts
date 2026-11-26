import type { LucideIcon } from "lucide-react";
import type { FlowNodeKind } from "@/components/ds/flow";
import type { Tone } from "@/components/ds/tone";
import type { BlockInfo } from "../graph";
import type { WorkflowsT } from "../labels";
import { appOf, categoryTone, metaOf } from "./block-picker";

// Outside canvas.tsx: the editor uses it without loading React Flow.
// Node look by block: category colour and icon, or the app logo; the
// small label is the app name, otherwise the category.
export function kindOf(
  type: string,
  t: WorkflowsT,
  block?: BlockInfo,
): {
  kind: FlowNodeKind;
  kindLabel: string;
  icon: LucideIcon;
  tone: Tone;
  logo?: string;
} {
  const [category, icon] = metaOf(type);
  const kind: FlowNodeKind =
    type === "condition" || type === "switch"
      ? "condition"
      : type === "human.approve"
        ? "approval"
        : category === "ai"
          ? "ai"
          : "action";
  const tone = categoryTone[category];
  if (category === "apps") {
    const app = block ? appOf(block) : undefined;
    return {
      kind,
      kindLabel: app?.label ?? t("blocks.category.apps"),
      icon,
      tone,
      ...(app?.logo && { logo: app.logo }),
    };
  }
  return { kind, kindLabel: t(`blocks.category.${category}`), icon, tone };
}
