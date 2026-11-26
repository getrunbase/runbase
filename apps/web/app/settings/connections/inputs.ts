// Input schemas of the connections server actions.
import { z } from "zod";
import { trimmed } from "@/lib/action-input";

export const connectInput = z.object({
  provider: trimmed.min(1).max(100),
  name: z.string().trim().max(100).optional(),
  popup: z.literal("1").optional(),
});
export const idInput = z.object({ id: z.uuid() });
