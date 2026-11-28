// "Switch" block: tests a record field (relations
// included) against an ordered list of cases. The first matching case
// gives the branch (case id); no case: `else` branch ("Else").
// Value mode (A5): `value` (any run template, e.g.
// `{{steps.decide.output.next}}`) replaces object / recordId / field.
import { z } from "zod";
import { defineBlock } from "../block";
import { evaluateValue, type Condition, type Filter } from "../../filter";

const cases = z.array(
  z.object({
    id: z.string().min(1),
    label: z.string(),
    op: z.string().min(1),
    value: z.unknown().optional(),
  }),
);
export const switchRecordInput = z.object({
  object: z.string().min(1),
  recordId: z.string(),
  // Path of the tested field, e.g. `stage` or `contact.entreprise.taille`.
  field: z.string().min(1),
  cases,
});
// strict: an invalid record input (object / field) does not fall back to value
// mode with an undefined `value`.
export const switchValueInput = z
  .object({ value: z.unknown(), cases })
  .strict();
export const switchInput = z.union([switchRecordInput, switchValueInput]);
type Case = z.infer<typeof cases>[number];

// Condition of a case, in the filter DSL format.
export const caseFilter = (field: string, c: Case) =>
  ({
    field,
    op: c.op,
    ...(c.value !== undefined && { value: c.value }),
  }) as Filter;

// Dynamic branches: one per case, then `else`.
export const switchBranches = (input: unknown) => {
  const list = (input as { cases?: Case[] } | undefined)?.cases;
  return [...(Array.isArray(list) ? list.map((c) => c.id) : []), "else"];
};

export const switchBlock = defineBlock({
  type: "switch",
  label: "Switch",
  description:
    'Routes to a branch based on a record field\'s value, or on any run value ({ value: "{{steps.x.output.y}}", cases }): one case per value. No match takes the branch named `else` (shown as Otherwise in the editor; never `default` or `otherwise`).',
  sideEffect: false,
  inputSchema: switchInput,
  outputSchema: z.object({
    case: z.string().nullable(),
    label: z.string(),
    reason: z.string(),
  }),
  branches: [],
  branchesFor: switchBranches,
  run: async (input, { services }) => {
    for (const c of input.cases) {
      const hit =
        "object" in input
          ? await services.records.matches(
              input.recordId,
              caseFilter(input.field, c),
            )
          : evaluateValue(c.op as Condition["op"], input.value, c.value);
      if (hit)
        return {
          branch: c.id,
          output: { case: c.id, label: c.label, reason: `case ${c.label}` },
        };
    }
    return {
      branch: "else",
      output: { case: null, label: "Otherwise", reason: "no case: Otherwise" },
    };
  },
});
