// Validation checks of function (`fn.<name>`) steps.
import { getBlock, type Block } from "../blocks";
import { objectsService } from "../objects";
import { paths } from "../runs/templates";
import type { TenantContext } from "../tenant";
import { errorItem, type ErrorItem } from "../errors/app-error";
import { functionsService } from "../functions";
import { secretsService } from "../secrets";
import { z } from "zod";
import { fnName, type Step } from "./validate-shared";

// Record columns readable in `{{record.…}}` (besides the object fields).
const RECORD_PROPS = new Set([
  "id",
  "organizationId",
  "workspaceId",
  "objectId",
  "externalId",
  "data",
  "isTest",
  "createdAt",
  "updatedAt",
]);

type JsonSchema = {
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: unknown;
};
// Known output keys of a step: JSON outputSchema (function) or
// zod object (block). undefined = unknown (free output).
function outputKeys(block: Block, fnSchema?: JsonSchema) {
  if (fnSchema)
    return fnSchema.properties && fnSchema.additionalProperties !== true
      ? new Set(Object.keys(fnSchema.properties))
      : undefined;
  return block.outputSchema instanceof z.ZodObject
    ? new Set(Object.keys(block.outputSchema.shape))
    : undefined;
}

// fn.<name> step: required inputs of the inputSchema present,
// `{{steps.x.output.y}}` refs to a declared field of x's output,
// `{{record.y}}` to a field of the trigger object. Unverifiable ref
// (event.*, free output) on a required input: warning.
export async function functionStepChecks(
  ctx: TenantContext,
  s: Step,
  steps: Step[],
  triggerObject: string | undefined,
  errors: ErrorItem[],
  warnings: ErrorItem[],
) {
  const { name, version } = fnName(s.type);
  const f = await functionsService.get(ctx, name, version);
  if (!f) return;
  const schema = (f.inputSchema ?? {}) as JsonSchema;
  const input = (s.input ?? {}) as Record<string, unknown>;
  const required = new Set(schema.required ?? []);
  for (const field of required)
    if (!(field in input))
      errors.push(
        errorItem(
          "workflows.missingFunctionInput",
          "{step}: missing required input {field} (function {fn})",
          { step: s.id, field, fn: name },
        ),
      );
  const object = triggerObject
    ? await objectsService.get(ctx, triggerObject)
    : null;
  const fields = new Set(
    ((object?.fields ?? []) as { key: string }[]).map((x) => x.key),
  );
  for (const [key, value] of Object.entries(input))
    for (const p of paths(value)) {
      const variable = `{{${p}}}`;
      const seg = p.split(".");
      let checked = false;
      if (seg[0] === "steps" && seg[2] === "output" && seg[3]) {
        const src = steps.find((x) => x.id === seg[1]);
        const block = src && (await getBlock(ctx, src.type));
        if (src && block) {
          const fnOut = src.type.startsWith("fn.")
            ? (((
                await functionsService.get(
                  ctx,
                  fnName(src.type).name,
                  fnName(src.type).version,
                )
              )?.outputSchema ?? {}) as JsonSchema)
            : undefined;
          const keys = outputKeys(block, fnOut);
          if (keys) {
            checked = true;
            if (!keys.has(seg[3]))
              errors.push(
                errorItem(
                  "workflows.unknownRefField",
                  "{step}: {variable}: {source} has no output field {field}",
                  { step: s.id, variable, source: src.id, field: seg[3] },
                ),
              );
          }
        }
      } else if (seg[0] === "record" && seg[1] && object) {
        checked = true;
        if (!fields.has(seg[1]) && !RECORD_PROPS.has(seg[1]))
          errors.push(
            errorItem(
              "workflows.unknownRecordField",
              "{step}: {variable}: object {object} has no field {field}",
              { step: s.id, variable, object: object.slug, field: seg[1] },
            ),
          );
      } else if (
        ["now", "today", "run", "workflow", "secret", "depth"].includes(seg[0]!)
      )
        checked = true;
      if (!checked && required.has(key))
        warnings.push(
          errorItem(
            "workflows.unverifiedRef",
            "{step}: {variable} cannot be checked before the run (dynamic value)",
            { step: s.id, variable },
          ),
        );
    }
}

// Types of all steps, including those of loop.do.
const allTypes = (steps: Step[]): string[] =>
  steps.flatMap((s) => {
    const inner = (s.input as { do?: unknown } | undefined)?.do;
    return [s.type, ...(Array.isArray(inner) ? allTypes(inner as Step[]) : [])];
  });

// Functions used: each secret of permissions.secrets must
// exist (otherwise error: activation refused); localhost URL in the code =
// warning (unreachable from the sandbox).
export async function functionSecretsChecks(
  ctx: TenantContext,
  steps: Step[],
  errors: ErrorItem[],
  warnings: ErrorItem[],
) {
  const fns = [...new Set(allTypes(steps).filter((t) => t.startsWith("fn.")))];
  if (!fns.length) return;
  const defined = new Set((await secretsService.list(ctx)).map((x) => x.name));
  const missing = new Set<string>();
  for (const type of fns) {
    const { name, version } = fnName(type);
    const f = await functionsService.get(ctx, name, version);
    if (!f) continue;
    const perms = (f.permissions ?? {}) as { secrets?: string[] };
    for (const secret of perms.secrets ?? [])
      if (!defined.has(secret)) missing.add(secret);
    if (/\b(localhost|127\.0\.0\.1)\b/.test(f.code))
      warnings.push(
        errorItem(
          "workflows.localhostUrl",
          "function {fn}: localhost URL in the code, unreachable from the sandbox",
          { fn: name },
        ),
      );
  }
  for (const secret of missing)
    errors.push(
      errorItem("workflows.missingSecret", "Missing secret {name}", {
        name: secret,
      }),
    );
}
