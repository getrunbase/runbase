// Shared helpers of the MCP tools: results, errors and common schemas.
import { z } from "zod";
import { type TenantContext } from "@getrunbase/core/tenant";
import { objectsService } from "@getrunbase/core/objects";
import { AppError, appError, notFound } from "@getrunbase/core/errors";
import { type ShotReport } from "@getrunbase/core/render";
import { enforceLint, type LintWarning } from "@getrunbase/core/lint";
import { lintStrict } from "@getrunbase/core/workspaces";

// Machine code of an error: stable, message prefix (`[not_found] …`).
export function errorCode(e: unknown): string {
  // QuotaError, RunAlreadyActive, InvalidWorkflow… are
  // AppErrors: `kind` carries the machine category.
  if (e instanceof AppError) return e.kind;
  if (e instanceof z.ZodError) return "invalid_input";
  return "error";
}

// SQLSTATE of a raw Postgres error, direct or wrapped by Drizzle (`cause`).
function sqlState(e: unknown): string | undefined {
  for (let c: unknown = e, i = 0; c && i < 4; i++) {
    const code = (c as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    c = (c as { cause?: unknown }).cause;
  }
  return undefined;
}

// Raw database error -> AppError with a stable code. The Postgres or Drizzle
// message carries the SQL text and its parameters (workspace_id, values): it
// is never echoed. Only the constraint or column name is kept.
export function mapDbError(e: unknown): unknown {
  if (e instanceof AppError || e instanceof z.ZodError) return e;
  const state = sqlState(e);
  if (!state) return e;
  let c: unknown = e;
  while (
    (c as { cause?: unknown }).cause &&
    !(c as { constraint_name?: unknown }).constraint_name &&
    !(c as { column_name?: unknown }).column_name
  )
    c = (c as { cause?: unknown }).cause;
  const meta = c as { constraint_name?: string; column_name?: string };
  const name = String(
    meta.constraint_name ?? meta.column_name ?? "unknown",
  ).slice(0, 64);
  switch (state) {
    case "23505":
      return appError(
        "db.uniqueViolation",
        "Duplicate value: a record with this unique value already exists ({name}). Use an upsert with match, or change the value.",
        { name },
        { kind: "conflict" },
      );
    case "23503":
      return appError(
        "db.foreignKeyViolation",
        "Linked item missing or still referenced ({name}). Check the related ids.",
        { name },
        { kind: "invalid_input" },
      );
    case "23502":
      return appError(
        "db.notNullViolation",
        "Required value missing ({name}).",
        { name },
        { kind: "invalid_input" },
      );
    case "23514":
      return appError(
        "db.checkViolation",
        "Value refused by a validation rule ({name}).",
        { name },
        { kind: "invalid_input" },
      );
    case "57014":
      return appError(
        "db.timeout",
        "The database call took too long and was canceled. Narrow the request (filters, limit) and retry.",
        {},
        { kind: "error" },
      );
    case "40001":
    case "40P01":
      return appError(
        "db.retry",
        "Concurrent write conflict. Retry the call.",
        {},
        { kind: "conflict" },
      );
  }
  if (state.startsWith("22"))
    return appError(
      "db.invalidValue",
      "Invalid value: an id or a field value is malformed.",
      {},
      { kind: "invalid_input" },
    );
  return appError(
    "db.error",
    "Database error ({state}). Retry; if it persists, report it with feedback.send.",
    { state },
    { kind: "error" },
  );
}

// JSON result, or an error readable by an agent: `[code] message` (ZodError
// detailed field by field).
export async function run(fn: () => Promise<unknown>) {
  try {
    const out = await fn();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(out ?? null) }],
    };
  } catch (raw) {
    const e = mapDbError(raw);
    const message =
      e instanceof z.ZodError
        ? `Invalid input:\n${z.prettifyError(e)}`
        : e instanceof Error
          ? e.message
          : String(e);
    return {
      isError: true,
      content: [
        { type: "text" as const, text: `[${errorCode(e)}] ${message}` },
      ],
    };
  }
}

// Missing value (null, false): actionable `not_found` error.
export async function must<T>(
  v: Promise<T>,
  what: string,
  id: string,
  hint: string,
): Promise<NonNullable<T>> {
  const out = await v;
  if (out === null || out === undefined || out === false)
    throw notFound("mcp.notFound", "{what} not found: {id}. {hint}", {
      what,
      id,
      hint,
    });
  return out as NonNullable<T>;
}

// Errors not to log: agent input, fixed by the agent.
export const SILENT = new Set([
  "invalid_input",
  "confirm_required",
  "not_found",
  "not_waiting",
  "conflict",
  // Test gate (workflows.untested): expected, cleared by a dry run.
  "untested",
]);

// Image result: one PNG capture per viewport/theme (seen by the AI) then a
// JSON text (errors, console, extra).
export async function runImage(
  fn: () => Promise<ShotReport & Record<string, unknown>>,
) {
  try {
    const { shots, ...rest } = await fn();
    return {
      content: [
        ...shots.flatMap((s) => [
          { type: "text" as const, text: `${s.viewport} · ${s.theme}` },
          {
            type: "image" as const,
            data: s.png.toString("base64"),
            mimeType: "image/png",
          },
        ]),
        { type: "text" as const, text: JSON.stringify(rest) },
      ],
    };
  } catch (e) {
    return run(() => Promise.reject(e));
  }
}

export const viewports = z
  .array(z.enum(["desktop", "mobile"]))
  .min(1)
  .max(2)
  .default(["desktop"])
  .describe("desktop 1280×800, mobile 390×844");
export const themes = z
  .array(z.enum(["light"]))
  .min(1)
  .max(2)
  .default(["light"]);

export async function getObject(ctx: TenantContext, slug: string) {
  const o = await objectsService.get(ctx, slug);
  if (!o)
    throw notFound(
      "mcp.objectNotFound",
      "Object not found: {slug}. See objects.list.",
      { slug },
    );
  return o;
}
export const objectId = async (ctx: TenantContext, slug: string) =>
  (await getObject(ctx, slug)).id;

export const slug = z.string().describe("Object slug or id (uuid)");
export const data = z.record(z.string(), z.unknown());
export const mode = z.enum(["merge", "replace"]).optional();
export const testFlag = z
  .boolean()
  .optional()
  .describe("Test data: deleted by workspace.purge_test");
export const upsertItem = z.object({
  test: testFlag,
  externalId: z.string().optional(),
  // `unique` field of the object used as key (email, domain).
  match: z.string().optional(),
  data,
  mode,
});

export const wfId = z.string().describe("Workflow id or name");
export type ToolConfig = {
  description?: string;
  inputSchema?: z.ZodObject;
};

// Save with definition lint: strict workspace = blocking error before the
// save; otherwise the result carries `lint` (warnings to fix) when any.
export async function linted(
  ctx: TenantContext,
  warnings: LintWarning[],
  save: () => Promise<unknown>,
) {
  if (warnings.length) enforceLint(warnings, await lintStrict(ctx));
  const out = await save();
  if (!warnings.length) return out;
  return out && typeof out === "object" && !Array.isArray(out)
    ? { ...out, lint: warnings }
    : { result: out, lint: warnings };
}
