// Input schemas of the functions server actions.
import { z } from "zod";
import { trimmed } from "@/lib/action-input";

const name = trimmed.min(1).max(200);
// Comma-separated list -> trimmed non-empty items.
const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
// JSON text -> value; empty = {}.
const json = z
  .string()
  .optional()
  .transform((v, c) => {
    try {
      return JSON.parse(v || "{}") as unknown;
    } catch {
      c.addIssue({ code: "custom", message: "Invalid JSON" });
      return z.NEVER;
    }
  });
const version = z.coerce.number().int().positive();

export const saveInput = z.object({
  name,
  code: z.string(),
  inputSchema: json.pipe(z.record(z.string(), z.unknown())),
  outputSchema: json.pipe(z.record(z.string(), z.unknown())),
  domains: csv,
  secrets: csv,
});
export const restoreInput = z.object({ name, version });
export const testInput = z.object({
  name,
  input: json,
  version: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .pipe(z.number().int().positive().optional()),
});
