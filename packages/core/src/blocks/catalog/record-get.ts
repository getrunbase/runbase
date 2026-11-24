import { z } from "zod";
import { defineBlock } from "../block";

// Reads a record; branches on whether it exists. `include`: relations to follow,
// e.g. `contacts` -> `record.included.contacts` (list for a loop).
export const recordGet = defineBlock({
  type: "record.get",
  label: "Read a record",
  description: "Reads a record by its id.",
  sideEffect: false,
  inputSchema: z.object({
    id: z.string(),
    include: z.array(z.string().min(1)).optional(),
  }),
  outputSchema: z.object({ record: z.unknown().nullable() }),
  branches: ["found", "not_found"],
  run: async ({ id, include }, { services }) => {
    const record = await services.records.get(id, { include });
    return { branch: record ? "found" : "not_found", output: { record } };
  },
});
