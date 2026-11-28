import { z } from "zod";
import { defineBlock, type BlockServices } from "../block";
import {
  conditionSchema,
  evaluateValue,
  schemaGraph,
  validateFilter,
  type Filter,
} from "../../filter";
import { notFound } from "../../errors/app-error";
import { regexFlags } from "../../workflows/validate-hints";

// Record mode: filter DSL evaluated on the record (relations included).
export const conditionRecordInput = z.object({
  object: z.string().min(1),
  recordId: z.string(),
  condition: z.unknown(),
});
// Value mode (A5): `left` is any run value, usually a
// template (`{{steps.x.output.y}}`, `{{event.type}}`, `{{run.test}}`),
// compared to `right` with a filter DSL operator.
export const conditionValueInput = z
  .object({
    left: z.unknown(),
    op: conditionSchema.shape.op,
    right: z.unknown().optional(),
    // regex only: JavaScript flags (e.g. "i"); caseInsensitive = "i".
    flags: z
      .string()
      .regex(/^[imsu]*$/, "flags: only i, m, s, u")
      .optional(),
    caseInsensitive: z.boolean().optional(),
  })
  .strict();
export const conditionInput = z.union([
  conditionRecordInput,
  conditionValueInput,
]);

// Value mode: no `object`, but `left` (condition) or `value` (switch).
// A malformed record input is still validated as a record input.
export const isValueMode = (input: unknown) =>
  !!input &&
  typeof input === "object" &&
  !("object" in input) &&
  ("left" in input || "value" in input);

type ObjectsList = BlockServices["objects"]["list"];

// Validates a condition against the schema of the object and its relations
// (when the workflow is saved).
export async function validateCondition(list: ObjectsList, input: unknown) {
  const parsed = conditionRecordInput
    .pick({ object: true, condition: true })
    .parse(input);
  const rows = await list();
  // The object may be given by uuid: the graph is keyed by slug.
  const object =
    rows.find((o) => o.id === parsed.object)?.slug ?? parsed.object;
  const { condition } = parsed;
  const graph = schemaGraph(object, rows);
  const self = graph.objects[object];
  if (!self)
    throw notFound("blocks.unknownObject", "Unknown object: {object}", {
      object,
    });
  validateFilter(self.fields, condition, graph);
}

// Evaluates the filter DSL on a record (SQL, relation paths included),
// or a comparison on a run value; branch true / false.
export const condition = defineBlock({
  type: "condition",
  label: "Condition (yes / no)",
  description:
    'Checks one or more rules on the record (relations included), or compares any run value ({ left: "{{steps.x.output.y}}", op, right }; op regex takes flags: "i" or caseInsensitive: true): continues on Yes if true, otherwise on No.',
  sideEffect: false,
  inputSchema: conditionInput,
  outputSchema: z.object({ result: z.boolean() }),
  branches: ["true", "false"],
  run: async (input, { services }) => {
    let result: boolean;
    if ("object" in input) {
      const { object, recordId, condition } = input;
      await validateCondition(services.objects.list, { object, condition });
      result = await services.records.matches(recordId, condition as Filter);
    } else
      result = evaluateValue(
        input.op,
        input.left,
        input.right,
        new Date(),
        regexFlags(input),
      );
    return { branch: String(result), output: { result } };
  },
});
