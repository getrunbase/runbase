// Graph of a workflow, normalized (pure, no server dependency: importable
// by the editor). `next[step][branch]` is a list of targets; missing
// `entry` = first step.
// Several targets or several entries = paths executed in parallel. No
// join: two paths that converge run the common step twice.
export type Targets = string[];
export type Graph = {
  entry: string[];
  next: Record<string, Record<string, string[]>>;
};

// Targets of a branch, without duplicates; missing = none.
export function targetsOf(v: unknown): string[] {
  const list: unknown[] = Array.isArray(v) ? v : [];
  return [...new Set(list.filter((t): t is string => typeof t === "string"))];
}

// Single read of a definition: entries and follow-ups as arrays.
export function normalizeGraph(def: {
  steps: readonly { id?: unknown }[];
  next?: Record<string, unknown>;
  entry?: unknown;
}): Graph {
  const first = def.steps[0]?.id;
  const entry =
    def.entry === undefined
      ? typeof first === "string"
        ? [first]
        : []
      : targetsOf(def.entry);
  const next: Graph["next"] = {};
  for (const [step, out] of Object.entries(def.next ?? {}))
    next[step] = Object.fromEntries(
      Object.entries((out ?? {}) as Record<string, unknown>).map(([b, t]) => [
        b,
        targetsOf(t),
      ]),
    );
  return { entry, next };
}
