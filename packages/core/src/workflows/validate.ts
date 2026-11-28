// Validation and dry run of a workflow.
import { getBlock } from "../blocks";
import { isValueMode, validateCondition } from "../blocks/catalog/condition";
import { validateMapping } from "../blocks/catalog/record-map";
import { caseFilter, switchRecordInput } from "../blocks/catalog/switch";
import { conditionSchema } from "../filter";
import { objectsService } from "../objects";
import { paths, TEMPLATE_ROOTS } from "../runs/templates";
import type { TenantContext } from "../tenant";
import type { Definition } from "./index";
import { normalizeGraph } from "./graph";
import { triggerSchema } from "../triggers/schema";
import { stepOptionsSchema } from "./step-options";
import { webhooksService } from "../webhooks";
import { workflowsService } from "./index";
import { errorItem, toErrorItem, type ErrorItem } from "../errors/app-error";
import { at, branchesOf, isTemplate, type Step } from "./validate-shared";
import {
  functionSecretsChecks,
  functionStepChecks,
} from "./validate-functions";
import {
  branchWarnings,
  filterChecks,
  httpDomainChecks,
  recordWriteChecks,
  sampleEvent,
  templateRefChecks,
  webhookMappingChecks,
} from "./validate-runtime";

export {
  coverageOf,
  dryRun,
  testStep,
  unreachedWrites,
  type DryRunOptions,
  type DryRunPath,
  type DryRunStep,
  type Pin,
} from "./dry-run";

// Unknown `{{…}}` variables of a step: root outside the run variables,
// or `steps.<id>` of a nonexistent step. In loop (`do`) and list.map
// (`mapping`), `item` and `index` are added.
function templateErrors(
  s: Step,
  ids: Set<string>,
  errors: ErrorItem[],
  extra: string[] = [],
) {
  const check = (value: unknown, more: string[]) => {
    for (const p of paths(value)) {
      const [root, id] = p.split(".");
      if (root === "steps") {
        if (!id || !ids.has(id))
          errors.push(
            errorItem(
              "workflows.unknownStepRef",
              "{step}: {variable}: step {id} does not exist",
              { step: s.id, variable: `{{${p}}}`, id: id ?? "?" },
            ),
          );
      } else if (!TEMPLATE_ROOTS.has(root!) && !more.includes(root!))
        errors.push(
          errorItem(
            "workflows.unknownVariable",
            "{step}: unknown variable {variable}",
            { step: s.id, variable: `{{${p}}}` },
          ),
        );
    }
  };
  const input = (s.input ?? {}) as Record<string, unknown>;
  const local = ["item", "index"];
  if (s.type === "loop" && Array.isArray(input.do)) {
    const { do: inner, ...rest } = input;
    check(rest, extra);
    const all = new Set([...ids, ...(inner as Step[]).map((x) => x.id)]);
    for (const x of inner as Step[])
      templateErrors(x, all, errors, [...extra, ...local]);
  } else if (s.type === "list.map" || s.type === "record.map") {
    // record.map: `{{source.…}}` (source record) shown by the editor.
    const { mapping, ...rest } = input;
    check(rest, extra);
    check(mapping, [...extra, ...local, "source"]);
  } else check(input, extra);
}

// List of errors (English text); empty = valid.
export async function validateDefinition(
  ctx: TenantContext,
  definition: Definition,
) {
  return (await validateItems(ctx, definition)).map((i) => i.message);
}

// Field error (zod): path + message.
const fieldError = (path: string, message: string) =>
  errorItem("workflows.invalidField", "{path}: {message}", { path, message });
// Error thrown by a step check (condition…).
const stepError = (step: string, e: unknown) =>
  errorItem("workflows.stepError", "{step}: {message}", {
    step,
    message: toErrorItem(e).message,
  });

// Translatable errors (code + params); empty = valid. `warnings` (if
// provided) receives the non-blocking warnings.
export async function validateItems(
  ctx: TenantContext,
  definition: Definition,
  warnings: ErrorItem[] = [],
) {
  const errors: ErrorItem[] = [];
  const steps = definition.steps as Step[];
  const { entry, next } = normalizeGraph(definition);
  const ids = new Set(steps.map((s) => s.id));
  // Trigger: known type, required fields, existing object.
  const trigger = triggerSchema.safeParse(
    definition.trigger ?? {
      type: "trigger.manual",
    },
  );
  if (!trigger.success)
    for (const i of trigger.error.issues)
      errors.push(
        fieldError(
          `trigger${i.path.length ? `.${i.path.join(".")}` : ""}`,
          i.message,
        ),
      );
  else if (
    "object" in trigger.data &&
    trigger.data.object &&
    !(await objectsService.get(ctx, trigger.data.object))
  )
    errors.push(
      errorItem(
        "workflows.unknownTriggerObject",
        "trigger.object: unknown object {object}",
        { object: trigger.data.object },
      ),
    );
  // Webhook sample: first event of the last received payload.
  let event: unknown;
  if (trigger.success && trigger.data.type === "trigger.webhook") {
    const t = trigger.data;
    const hook = (await webhooksService.list(ctx)).find(
      (w) => w.name === t.webhook,
    );
    event = sampleEvent(hook);
    if (!hook)
      errors.push(
        errorItem(
          "workflows.unknownWebhook",
          "trigger.webhook: unknown webhook {webhook}",
          { webhook: t.webhook },
        ),
      );
    const object = t.object ? await objectsService.get(ctx, t.object) : null;
    const fields = (object?.fields ?? []) as {
      key: string;
      unique?: boolean;
    }[];
    if (t.mapping && !t.object)
      errors.push(
        errorItem(
          "workflows.mappingNeedsObject",
          "trigger.object: required with a mapping",
        ),
      );
    for (const k of Object.keys(t.mapping ?? {}))
      if (object && !fields.some((f) => f.key === k))
        errors.push(
          errorItem(
            "workflows.unknownMappingField",
            "trigger.mapping: unknown field {field}",
            { field: k },
          ),
        );
    if (t.match && object && !fields.some((f) => f.key === t.match && f.unique))
      errors.push(
        errorItem(
          "workflows.matchNotUnique",
          "trigger.match: {field} must be a unique field",
          { field: t.match },
        ),
      );
    webhookMappingChecks(t, event, errors, warnings);
  }
  if (trigger.success && trigger.data.type === "trigger.run_failed") {
    const w = trigger.data.workflow;
    const all = await workflowsService.list(ctx);
    if (w && !all.some((x) => x.id === w || x.name === w))
      errors.push(
        errorItem(
          "workflows.unknownTriggerWorkflow",
          "trigger.workflow: unknown workflow {workflow}",
          { workflow: w },
        ),
      );
  }
  if (steps.length && !entry.length)
    errors.push(errorItem("workflows.noEntry", "entry: no entry step"));
  for (const id of entry)
    if (!ids.has(id))
      errors.push(
        errorItem(
          "workflows.unknownEntry",
          "entry: step {step} does not exist",
          {
            step: id,
          },
        ),
      );

  for (const s of steps) {
    const block = await getBlock(ctx, s.type);
    if (!block) {
      errors.push(
        errorItem("workflows.unknownBlock", "{step}: unknown block {type}", {
          step: s.id,
          type: s.type,
        }),
      );
      continue;
    }
    templateErrors(s, ids, errors);
    if (s.type.startsWith("fn."))
      await functionStepChecks(
        ctx,
        s,
        steps,
        trigger.success && "object" in trigger.data
          ? (trigger.data.object ?? undefined)
          : undefined,
        errors,
        warnings,
      );
    const opts = stepOptionsSchema.safeParse(s);
    if (!opts.success)
      for (const i of opts.error.issues)
        errors.push(fieldError(`${s.id}.${i.path.join(".")}`, i.message));
    // Inputs: a `{{…}}` template is only known at execution.
    const input = (s.input ?? {}) as Record<string, unknown>;
    const parsed = block.inputSchema.safeParse(input);
    if (!parsed.success)
      for (const i of parsed.error.issues)
        if (!isTemplate(at(input, i.path)))
          errors.push(fieldError(`${s.id}.${i.path.join(".")}`, i.message));
    // Value mode (A5): case operators checked, no object schema.
    if (s.type === "switch" && isValueMode(s.input)) {
      const cases = (s.input as { cases?: { op?: unknown }[] }).cases ?? [];
      for (const [i, c] of cases.entries())
        if (!conditionSchema.shape.op.safeParse(c?.op).success)
          errors.push(
            fieldError(`${s.id}.cases.${i}.op`, `Unknown operator: ${c?.op}`),
          );
    } else if (
      s.type === "list.filter" ||
      (s.type === "condition" && !isValueMode(s.input))
    )
      await validateCondition(() => objectsService.list(ctx), s.input).catch(
        (e: unknown) => errors.push(stepError(s.id, e)),
      );
    if (s.type === "switch") {
      const p = switchRecordInput.safeParse(s.input);
      if (p.success)
        await validateCondition(() => objectsService.list(ctx), {
          object: p.data.object,
          condition: {
            all: p.data.cases.map((c) => caseFilter(p.data.field, c)),
          },
        }).catch((e: unknown) => errors.push(stepError(s.id, e)));
    }
    if (s.type === "workflow.run") {
      const w = (s.input as { workflow?: unknown } | undefined)?.workflow;
      if (
        typeof w === "string" &&
        !isTemplate(w) &&
        !(await workflowsService.list(ctx)).some(
          (x) => x.id === w || x.name === w,
        )
      )
        errors.push(
          errorItem(
            "workflows.unknownWorkflow",
            "{step}: unknown workflow {workflow}",
            { step: s.id, workflow: w },
          ),
        );
    }
    if (s.type === "record.map")
      errors.push(
        ...(await validateMapping(
          () => objectsService.list(ctx),
          s.input,
          s.id,
        )),
      );
    // Branches: a branch without a follow-up ends the workflow.
    const out = next[s.id];
    if (out) {
      const branches = branchesOf(s, block);
      for (const [b, targets] of Object.entries(out)) {
        if (!branches.includes(b))
          errors.push(
            errorItem(
              "workflows.unknownBranch",
              "{step}: unknown branch {branch} (valid: {valid})",
              {
                step: s.id,
                branch: b,
                valid: branches.join(", ") || "none",
              },
            ),
          );
        for (const target of targets)
          if (!ids.has(target))
            errors.push(
              errorItem(
                "workflows.unknownTarget",
                "{step}.{branch}: step {target} does not exist",
                { step: s.id, branch: b, target },
              ),
            );
      }
    }
  }
  const triggerObject =
    trigger.success && "object" in trigger.data
      ? (trigger.data.object ?? undefined)
      : undefined;
  await functionSecretsChecks(ctx, steps, errors, warnings, next);
  await recordWriteChecks(ctx, triggerObject, steps, errors);
  await templateRefChecks(ctx, steps, event, errors, warnings);
  await filterChecks(
    ctx,
    trigger.success ? trigger.data : undefined,
    steps,
    errors,
  );
  await branchWarnings(ctx, steps, next, warnings);
  await httpDomainChecks(ctx, steps, warnings);
  for (const id of Object.keys(next))
    if (!ids.has(id))
      errors.push(
        errorItem("workflows.unknownNext", "next: step {step} does not exist", {
          step: id,
        }),
      );

  // Orphans: steps not reachable from the entries.
  const seen = new Set<string>();
  const todo = [...entry];
  while (todo.length) {
    const id = todo.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    todo.push(...Object.values(next[id] ?? {}).flat());
  }
  for (const id of ids)
    if (!seen.has(id))
      errors.push(
        errorItem(
          "workflows.unlinkedStep",
          "{step}: step not connected (no link from the trigger)",
          { step: id },
        ),
      );
  return errors;
}
