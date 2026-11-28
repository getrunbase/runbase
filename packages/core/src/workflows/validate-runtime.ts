// Validation checks for mistakes that otherwise only show at run time:
// webhook mapping and event refs against the stored sample, step refs
// against output schemas, filters, unhandled branches, http domains.
import { getBlock } from "../blocks";
import { validateCondition } from "../blocks/catalog/condition";
import { assertAllowed } from "../blocks/catalog/external";
import { objectsService } from "../objects";
import { paths } from "../runs/templates";
import type { TenantContext } from "../tenant";
import type { Trigger } from "../triggers/schema";
import { pick, splitPayload } from "../webhooks";
import { workspaceSettings } from "../workspaces";
import { errorItem, toErrorItem, type ErrorItem } from "../errors/app-error";
import { stepOutputKeys } from "./validate-functions";
import { branchesOf, isTemplate, type Step } from "./validate-shared";

type WebhookTrigger = Extract<Trigger, { type: "trigger.webhook" }>;
type Hook = { sample?: unknown; config?: unknown };

// First event the stored sample produces (split batches included); the
// event payload is that item itself, not `{ payload: … }`.
export function sampleEvent(hook: Hook | undefined): unknown {
  if (hook?.sample == null) return undefined;
  try {
    const split = (hook.config as { splitPath?: string } | null)?.splitPath;
    return splitPayload(hook.sample, split)[0];
  } catch {
    return undefined;
  }
}

// trigger.webhook: mapping paths and the match field resolved on the
// sample. Missing path or `payload.` prefix: warning; match key without
// a value: error (the upsert would have no key).
export function webhookMappingChecks(
  t: WebhookTrigger,
  event: unknown,
  errors: ErrorItem[],
  warnings: ErrorItem[],
) {
  const mapping = t.mapping ?? {};
  for (const [field, path] of Object.entries(mapping)) {
    if (path.startsWith("payload.") && !hasKey(event, "payload"))
      warnings.push(
        errorItem(
          "workflows.mappingPayloadPrefix",
          "trigger.mapping.{field}: {path}: paths start at the payload root, drop the payload. prefix",
          { field, path },
        ),
      );
    else if (event !== undefined && pick(event, path) === undefined)
      warnings.push(
        errorItem(
          "workflows.mappingPathMissing",
          "trigger.mapping.{field}: {path} is not in the webhook sample",
          { field, path },
        ),
      );
  }
  if (!t.match || !t.mapping) return;
  const path = mapping[t.match];
  if (path === undefined)
    errors.push(
      errorItem(
        "workflows.matchNotMapped",
        "trigger.match: {field} is not in the mapping, the record key would be empty",
        { field: t.match },
      ),
    );
  else if (event !== undefined && pick(event, path) === undefined)
    errors.push(
      errorItem(
        "workflows.matchUndefined",
        "trigger.match: {field} ({path}) is undefined in the webhook sample",
        { field: t.match, path },
      ),
    );
}

const hasKey = (o: unknown, k: string) =>
  !!o && typeof o === "object" && k in o;

// Steps of the workflow, loop bodies included.
export const flatSteps = (steps: Step[]): Step[] =>
  steps.flatMap((s) => {
    const inner = (s.input as { do?: unknown } | undefined)?.do;
    return [s, ...(Array.isArray(inner) ? flatSteps(inner as Step[]) : [])];
  });

// `{{steps.X.…}}` must read `output`, and `output.<key>` a declared key of
// X's output schema (fn.* step inputs are checked by functionStepChecks).
// `{{event.…}}` checked against the webhook sample (warning).
export async function templateRefChecks(
  ctx: TenantContext,
  steps: Step[],
  event: unknown,
  errors: ErrorItem[],
  warnings: ErrorItem[],
) {
  const all = flatSteps(steps);
  for (const s of all) {
    for (const p of paths(s.input ?? {})) {
      const variable = `{{${p}}}`;
      const seg = p.split(".");
      if (seg[0] === "steps") {
        const src = all.find((x) => x.id === seg[1]);
        if (!src) continue; // unknownStepRef already reported
        if (seg[2] !== "output") {
          errors.push(
            errorItem(
              "workflows.stepRefNotOutput",
              "{step}: {variable}: step values are read under steps.{source}.output",
              { step: s.id, variable, source: src.id },
            ),
          );
          continue;
        }
        if (!seg[3] || s.type.startsWith("fn.")) continue;
        const keys = await stepOutputKeys(ctx, src);
        if (keys && !keys.has(seg[3]))
          errors.push(
            errorItem(
              "workflows.unknownRefField",
              "{step}: {variable}: {source} has no output field {field}",
              { step: s.id, variable, source: src.id, field: seg[3] },
            ),
          );
      } else if (
        seg[0] === "event" &&
        seg[1] &&
        seg[1] !== "recordId" &&
        event !== undefined &&
        pick(event, seg.slice(1).join(".")) === undefined
      )
        warnings.push(
          errorItem(
            "workflows.unknownEventPath",
            "{step}: {variable} is not in the webhook sample (event is the payload itself)",
            { step: s.id, variable },
          ),
        );
    }
  }
}

// Filters run through the filter value schemas: schedule trigger filter
// and record.search filter (skipped when they hold templates).
export async function filterChecks(
  ctx: TenantContext,
  trigger: Trigger | undefined,
  steps: Step[],
  errors: ErrorItem[],
) {
  const list = () => objectsService.list(ctx);
  const dynamic = (v: unknown) => isTemplate(JSON.stringify(v ?? null));
  if (
    trigger?.type === "trigger.schedule" &&
    trigger.object &&
    trigger.filter &&
    !dynamic(trigger.filter)
  )
    await validateCondition(list, {
      object: trigger.object,
      condition: trigger.filter,
    }).catch((e: unknown) =>
      errors.push(
        errorItem("workflows.invalidField", "{path}: {message}", {
          path: "trigger.filter",
          message: toErrorItem(e).message,
        }),
      ),
    );
  for (const s of flatSteps(steps)) {
    if (s.type !== "record.search") continue;
    const i = (s.input ?? {}) as { object?: unknown; filter?: unknown };
    if (typeof i.object !== "string" || isTemplate(i.object)) continue;
    if (i.filter === undefined || dynamic(i.filter)) continue;
    await validateCondition(list, {
      object: i.object,
      condition: i.filter,
    }).catch((e: unknown) =>
      errors.push(
        errorItem("workflows.stepError", "{step}: {message}", {
          step: s.id,
          message: toErrorItem(e).message,
        }),
      ),
    );
  }
}

// Unhandled outcomes: a switch without its default (`else`) branch, and,
// in a webhook-triggered workflow, an unconnected empty / false /
// not_found branch (the run ends silently on it).
export async function branchWarnings(
  ctx: TenantContext,
  steps: Step[],
  next: Record<string, Record<string, string[]>>,
  webhook: boolean,
  warnings: ErrorItem[],
) {
  for (const s of steps) {
    const block = await getBlock(ctx, s.type);
    if (!block) continue;
    const out = next[s.id] ?? {};
    if (s.type === "switch" && Object.keys(out).length && !out.else?.length)
      warnings.push(
        errorItem(
          "workflows.switchNoDefault",
          "{step}: switch has no default (else) branch connected",
          { step: s.id },
        ),
      );
    if (
      !webhook ||
      !(
        s.type === "record.search" ||
        s.type === "condition" ||
        s.type.startsWith("fn.")
      )
    )
      continue;
    for (const b of branchesOf(s, block))
      if (["empty", "false", "not_found"].includes(b) && !out[b]?.length)
        warnings.push(
          errorItem(
            "workflows.unhandledBranch",
            "{step}: branch {branch} is not connected, the run ends there silently",
            { step: s.id, branch: b },
          ),
        );
  }
}

// http.request with a literal URL whose host is not in the workspace
// allowedDomains: refused at run time.
export async function httpDomainChecks(
  ctx: TenantContext,
  steps: Step[],
  warnings: ErrorItem[],
) {
  const http = flatSteps(steps).filter((s) => s.type === "http.request");
  if (!http.length) return;
  const { allowedDomains } = await workspaceSettings(ctx);
  for (const s of http) {
    const url = (s.input as { url?: unknown } | undefined)?.url;
    if (typeof url !== "string" || isTemplate(url)) continue;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    try {
      assertAllowed(url, allowedDomains);
    } catch {
      warnings.push(
        errorItem(
          "workflows.domainNotAllowed",
          "{step}: {host} is not in the workspace allowed domains, the request will be refused",
          { step: s.id, host },
        ),
      );
    }
  }
}
