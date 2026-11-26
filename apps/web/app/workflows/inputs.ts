// Input schemas of the workflow editor server actions.
import { z } from "zod";
import { id, trimmed } from "@/lib/action-input";
import type { Definition } from "./graph";

// Shape check only: the core validates the content (validateItems).
export const definition = z
  .looseObject({
    trigger: z.record(z.string(), z.unknown()),
    steps: z.array(z.looseObject({})),
  })
  .transform((d) => d as unknown as Definition);
export const createInput = z.object({ name: trimmed.max(200).default("") });
export const saveInput = z.object({
  id,
  name: trimmed.max(200),
  definition,
});
export const dryRunInput = z.object({
  definition,
  recordIds: z.array(id).max(100),
});
export const statusInput = z.object({
  id,
  status: z.enum(["active", "paused"]),
});
export const nameInput = z.object({ name: trimmed.min(1).max(200) });
export const restoreInput = z.object({
  id,
  version: z.number().int().positive(),
});
// Step form: choices of a connector input, token for the Google Picker.
export const optionsInput = z.object({
  type: z.string().min(1).max(200),
  field: z.string().min(1).max(100),
  input: z.record(z.string(), z.unknown()),
});
export const tokenInput = z.object({
  provider: z.string().min(1).max(100),
  connection: z.string().max(200).optional(),
});

export const testStepInput = z.object({
  stepId: z.string().min(1).max(200),
  live: z.boolean(),
});
