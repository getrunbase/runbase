// Server action input validation: a server action is a public endpoint,
// its arguments come from the client as is. Parse them with zod before
// calling the core; a malformed input is a translatable AppError.
//   const { id } = parseInput(z.object({ id: z.uuid() }), formInput(f));
import { z } from "zod";
import { appError } from "@getrunbase/core/app-error";

export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success)
    throw appError("web.invalidInput", "Invalid input: {detail}", {
      detail: z.prettifyError(r.error),
    });
  return r.data;
}

// FormData -> plain object: one value per key, an array for repeated keys
// (checkbox groups). Files are dropped (not used by these actions).
export function formInput(f: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of new Set(f.keys())) {
    const v = f.getAll(k).filter((x): x is string => typeof x === "string");
    out[k] = v.length > 1 ? v : (v[0] ?? "");
  }
  return out;
}

// Common fields.
export const trimmed = z.string().trim();
export const id = z.string().trim().min(1).max(200);
export const uuid = z.uuid();
export const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined || v === "" ? [] : [v].flat()));
