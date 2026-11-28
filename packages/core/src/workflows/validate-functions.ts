// Validation checks of function (`fn.<name>`) steps.
import { getBlock, type Block } from "../blocks";
import { objectsService } from "../objects";
import { paths } from "../runs/templates";
import type { TenantContext } from "../tenant";
import { errorItem, type ErrorItem } from "../errors/app-error";
import { functionsService } from "../functions";
import { secretsService } from "../secrets";
import { z } from "zod";
import { CONNECTION_INPUT } from "@getrunbase/node-sdk";
import { resolveAi } from "../ai-providers";
import { connectionsService } from "../connections";
import { fnName, isTemplate, type Step } from "./validate-shared";

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
  if (!(block.outputSchema instanceof z.ZodObject)) return undefined;
  // Loose object (extra keys allowed): free output.
  const catchall = (block.outputSchema.def as { catchall?: unknown }).catchall;
  if (catchall && !(catchall instanceof z.ZodNever)) return undefined;
  return new Set(Object.keys(block.outputSchema.shape));
}

// Known output keys of a step (block or function); undefined = unknown.
// continueOnFail adds `error` (the engine outputs { error } on failure).
export async function stepOutputKeys(ctx: TenantContext, src: Step) {
  const keys = await declaredOutputKeys(ctx, src);
  if (keys && src.retry?.continueOnFail) keys.add("error");
  return keys;
}

async function declaredOutputKeys(ctx: TenantContext, src: Step) {
  const block = await getBlock(ctx, src.type);
  if (!block) return undefined;
  const fnOut = src.type.startsWith("fn.")
    ? (((
        await functionsService.get(
          ctx,
          fnName(src.type).name,
          fnName(src.type).version,
        )
      )?.outputSchema ?? {}) as JsonSchema)
    : undefined;
  return outputKeys(block, fnOut);
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
        if (src) {
          const keys = await stepOutputKeys(ctx, src);
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

// Steps of all levels, including those of loop.do.
const allSteps = (steps: Step[]): Step[] =>
  steps.flatMap((s) => {
    const inner = (s.input as { do?: unknown } | undefined)?.do;
    return [s, ...(Array.isArray(inner) ? allSteps(inner as Step[]) : [])];
  });

// Secrets the steps need: function permissions.secrets, the key secret
// of ai.* steps (input.ai), `{{secret.X}}` refs (http...) and the
// webhook.emit HMAC secret. Each must exist (otherwise error: activation
// refused). OAuth connector nodes need a connection to their provider.
// localhost URL in a function's code = warning (unreachable from the
// sandbox).
export async function functionSecretsChecks(
  ctx: TenantContext,
  steps: Step[],
  errors: ErrorItem[],
  warnings: ErrorItem[],
  next: Record<string, Record<string, string[]>> = {},
) {
  const flat = allSteps(steps);
  // Secret name -> steps that need it.
  const needed = new Map<string, Step[]>();
  const need = (name: string, s: Step) =>
    needed.set(name, [...(needed.get(name) ?? []), s]);
  for (const s of flat) {
    const input = (s.input ?? {}) as Record<string, unknown>;
    if (s.type.startsWith("ai.")) {
      if (input.ai === undefined)
        errors.push(
          errorItem(
            "workflows.missingAiConfig",
            "{step}: no AI provider set (input.ai { provider, model, secret }): there is no default provider",
            { step: s.id },
          ),
        );
      else {
        const ai = resolveAi(input.ai);
        if (ai) need(ai.keySecret, s);
      }
    }
    if (
      s.type === "webhook.emit" &&
      typeof input.secret === "string" &&
      !isTemplate(input.secret)
    )
      need(input.secret, s);
    for (const p of paths(input)) {
      const [root, name] = p.split(".");
      if (root === "secret" && name) need(name, s);
    }
  }
  const fns = [
    ...new Set(flat.map((s) => s.type).filter((t) => t.startsWith("fn."))),
  ];
  for (const type of fns) {
    const { name, version } = fnName(type);
    const f = await functionsService.get(ctx, name, version);
    if (!f) continue;
    const perms = (f.permissions ?? {}) as { secrets?: string[] };
    for (const secret of perms.secrets ?? [])
      for (const s of flat.filter((x) => x.type === type)) need(secret, s);
    if (/\b(localhost|127\.0\.0\.1)\b/.test(f.code))
      warnings.push(
        errorItem(
          "workflows.localhostUrl",
          "function {fn}: localhost URL in the code, unreachable from the sandbox",
          { fn: name },
        ),
      );
  }
  if (needed.size) {
    const defined = new Set(
      (await secretsService.list(ctx)).map((x) => x.name),
    );
    // A step that continues on failure with a connected error branch
    // handles the missing secret: warning instead of error.
    const handled = (s: Step) =>
      !!s.retry?.continueOnFail && !!next[s.id]?.error?.length;
    for (const [secret, users] of needed)
      if (defined.has(secret)) continue;
      else if (users.every(handled))
        warnings.push(
          errorItem(
            "workflows.missingSecretHandled",
            "Missing secret {name}: {steps} will take the error branch until it is set",
            { name: secret, steps: users.map((s) => s.id).join(", ") },
          ),
        );
      else
        errors.push(
          errorItem("workflows.missingSecret", "Missing secret {name}", {
            name: secret,
          }),
        );
  }
  let conns: { provider: string; name: string }[] | undefined;
  for (const s of flat) {
    const provider = (await getBlock(ctx, s.type))?.oauthProvider;
    if (!provider) continue;
    conns ??= await connectionsService.list(ctx);
    const wanted = (s.input as Record<string, unknown> | undefined)?.[
      CONNECTION_INPUT
    ];
    const named =
      typeof wanted === "string" && wanted && !isTemplate(wanted)
        ? wanted
        : undefined;
    if (
      !conns.some(
        (c) => c.provider === provider && (!named || c.name === named),
      )
    )
      errors.push(
        errorItem(
          "workflows.missingConnection",
          "{step}: no {provider} connection {name}: connect the account in Settings > Connections",
          { step: s.id, provider, name: named ?? "(any)" },
        ),
      );
  }
}
