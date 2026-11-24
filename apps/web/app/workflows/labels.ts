// Workflow editor labels. Technical identifiers
// (branches, input keys, operators, statuses) stay stored as is;
// only the display goes through messages/<locale>/workflows.json (`labels.*`).
import type { useTranslations } from "next-intl";

// Translator for the `workflows` namespace (useTranslations / getTranslations).
export type WorkflowsT = ReturnType<typeof useTranslations<"workflows">>;
type Loose = { (key: string): string; has(key: string): boolean };

// Unknown key: the raw identifier is shown.
const tr = (t: Loose, group: string) => (k: string) => {
  const key = `labels.${group}.${k.replace(/^trigger\./, "")}`;
  return k && t.has(key) ? t(key) : k;
};

// Translated tables, built at render time with the workflows namespace `t`.
export function makeLabels(wt: WorkflowsT) {
  const t = wt as unknown as Loose;
  const branch = tr(t, "branch");
  return {
    branch,
    output: tr(t, "output"),
    input: tr(t, "input"),
    operator: tr(t, "operator"),
    fieldType: tr(t, "fieldType"),
    trigger: tr(t, "trigger"),
    status: tr(t, "status"),
    // Explanation of a run status, for someone who does not know the engine.
    statusHint: tr(t, "statusHint"),
    bool: (v: string) => (v === "true" || v === "false" ? branch(v) : v),
  };
}
export type Labels = ReturnType<typeof makeLabels>;

// Block label and description (`blocks.<type>.*`); falls back to the core's
// English text (workspace functions, block without a translation).
export function localizeBlocks<
  B extends { type: string; label: string; description: string },
>(blocks: B[], wt: WorkflowsT): B[] {
  const t = wt as unknown as Loose;
  const tr = (b: B, k: "label" | "description") => {
    // Workspace function: entered name kept, generic description.
    if (b.type.startsWith("fn."))
      return k === "label" ? b.label : t("blocks.workspaceFunction");
    const key = `blocks.${b.type}.${k}`;
    return t.has(key) ? t(key) : b[k];
  };
  return blocks.map((b) => ({
    ...b,
    label: tr(b, "label"),
    description: tr(b, "description"),
  }));
}

// Badge variant by status (failure in red, success filled).
export const statusVariant = (s: string) =>
  s === "failed"
    ? ("destructive" as const)
    : s === "succeeded"
      ? ("default" as const)
      : ("secondary" as const);
