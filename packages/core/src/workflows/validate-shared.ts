// Helpers shared by workflow validation and dry run.
import type { Block } from "../blocks";

export type Step = { id: string; type: string; input?: unknown };

export const isTemplate = (v: unknown) =>
  typeof v === "string" && v.includes("{{");
export const at = (v: unknown, path: PropertyKey[]) =>
  path.reduce<unknown>(
    (o, k) => (o as Record<PropertyKey, unknown> | undefined)?.[k],
    v,
  );
// Branches of a step: those of the block, or declared (ai.decide).
export const branchesOf = (s: Step, block: Block) =>
  block.branchesFor
    ? block.branchesFor(s.input)
    : block.branches.length
      ? block.branches
      : (((s.input as { branches?: unknown })?.branches as string[]) ?? []);

export const fnName = (type: string) => {
  const [name, v] = type.slice(3).split("@");
  return { name: name!, version: v ? Number(v) : undefined };
};
