// Input schema of the feedback admin action.
import { z } from "zod";
import { id } from "@/lib/action-input";

export const toggleInput = z.object({
  id,
  resolved: z
    .string()
    .optional()
    .transform((v) => v === "1"),
});
