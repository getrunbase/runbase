// Input schemas of the secrets server actions.
import { z } from "zod";
import { trimmed } from "@/lib/action-input";

const name = trimmed.min(1).max(200);
export const setInput = z.object({ name, value: z.string().max(65536) });
export const nameInput = z.object({ name });
