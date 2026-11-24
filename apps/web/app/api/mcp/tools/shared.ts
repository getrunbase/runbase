// Shared helpers of the MCP tools: results, errors and common schemas.
import { z } from "zod";
import { type TenantContext } from "@runbase/core/tenant";
import { objectsService } from "@runbase/core/objects";
import { AppError, notFound } from "@runbase/core/errors";
import { type ShotReport } from "@runbase/core/render";

// Machine code of an error: stable, message prefix (`[not_found] …`).
export function errorCode(e: unknown): string {
  // QuotaError, RunAlreadyActive, InvalidWorkflow… are
  // AppErrors: `kind` carries the machine category.
  if (e instanceof AppError) return e.kind;
  if (e instanceof z.ZodError) return "invalid_input";
  return "error";
}

// JSON result, or an error readable by an agent: `[code] message` (ZodError
// detailed field by field).
export async function run(fn: () => Promise<unknown>) {
  try {
    const out = await fn();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(out ?? null) }],
    };
  } catch (e) {
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

export const wfId = z.string().describe("Workflow id");
export type ToolConfig = {
  description?: string;
  inputSchema?: z.ZodObject;
};
