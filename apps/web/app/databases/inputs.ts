// Input schemas of the databases server actions.
import { z } from "zod";
import type { Field } from "@runbase/core/objects";
import { trimmed } from "@/lib/action-input";

// Shape check only: the core validates field definitions.
const field = z
  .looseObject({
    key: trimmed.min(1).max(200),
    label: z.string().max(200),
    type: z.string().min(1),
  })
  .transform((f) => f as unknown as Field);

export const createInput = z.object({
  name: trimmed.min(1).max(200),
  object: trimmed.min(1).max(200),
  fields: z.array(field).max(200).optional(),
});
export const templateInput = z.object({ template: z.string().default("") });
