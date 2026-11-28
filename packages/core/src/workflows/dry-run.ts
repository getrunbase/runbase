// Dry run of a workflow and single-step test (no side effects by default).
import { getBlock, blockContext, type BlockResult } from "../blocks";
import { StopError } from "../blocks/block";
import { blockEngine } from "../blocks/engine";
import { assertAiAllowed, chargeAi } from "../runs/budget";
import { recordsService } from "../records";
import {
  builtins,
  paths as templatePaths,
  renderInputs,
  stepInput,
} from "../runs/templates";
import { objectsService } from "../objects";
import { withDefaults, type Field } from "../objects/fields";
import { eventsService } from "../events";
import { pick, webhooksService } from "../webhooks";
import { triggerSchema } from "../triggers/schema";
import type { TenantContext } from "../tenant";
import type { Definition } from "./index";
import { normalizeGraph } from "./graph";
import {
  appError,
  errorItem,
  notFound,
  type ErrorItem,
} from "../errors/app-error";
import {
  functionsService,
  runLogged,
  type FunctionRow,
  type PlannedWrite,
} from "../functions";
import { decryptAll, secretsService } from "../secrets";
import { validateSchema } from "../functions/sandbox";
import { branchesOf, fnName, type Step } from "./validate-shared";

const MAX_STEPS = 50;

export type DryRunStep = {
  stepId: string;
  type: string;
  branch?: string;
  simulated: boolean;
  reason: string;
  // Translatable reason (code + params); `reason` = its English message.
  reasonItem?: ErrorItem;
  // Execution branch ("0", "1", "0.1"…): one path per parallel branch.
  path: string;
  input?: unknown;
  output?: unknown;
  // Pinned output (`pins`) used instead of running the block.
  pinned?: boolean;
  // Non-blocking findings, e.g. a {{record.*}} ref that renders empty.
  warnings?: string[];
  // fn.* steps: record / event writes the function planned (simulated).
  writes?: PlannedWrite[];
};
export type DryRunPath = {
  id: string;
  steps: DryRunStep[];
  error?: string;
  // How to fix `error` when it comes from a simulated null output.
  hint?: string;
};

// One dry run (one record, or none).
export type DryRunResult = {
  recordId: string | null;
  path: DryRunStep[];
  paths: DryRunPath[];
  error?: string;
  hint?: string;
  warnings?: string[];
  // Synthetic record built from the webhook sample and mapping.
  record?: Record<string, unknown>;
  // Steps reached in this run out of all steps of the definition.
  coverage?: Coverage;
  // Why this run does not count as a test (e.g. stopped at a condition).
  untested?: string;
  // Nothing to run on (no sample, no matching record): not a test.
  skipped?: string;
  skippedItem?: ErrorItem;
};

// Records sampled for a scheduled workflow on an object.
const SCHEDULE_SAMPLE = 5;

// Pinned output of a step (`definition.pins[stepId]`): replayed in dry run and
// in step tests instead of running the block (frozen sample data).
// `error`: forces the step to fail with that message (error branch, or
// continueOnFail fallback, or a failed path).
export type Pin = { output?: unknown; branch?: string; error?: string };

export type Coverage = { ran: number; total: number; unreached: string[] };

export type DryRunOptions = {
  // Actually runs the AI blocks (paid).
  ai?: boolean;
  // Payload of the triggering event (`{{event.…}}`).
  event?: unknown;
  workflowId?: string;
};

type Scope = Record<string, unknown>;

// Runs a step without side effects (except `live`): renders its input (provided or
// the definition's), plays the pinned output if there is one.
async function execStep(
  ctx: TenantContext,
  definition: Definition,
  step: Step,
  scope: Scope,
  o: { ai?: boolean; live?: boolean; input?: unknown } = {},
) {
  const block = await getBlock(ctx, step.type);
  if (!block)
    throw notFound("workflows.unknownBlock", "Unknown block: {type}", {
      type: step.type,
    });
  const raw = new Set(block.raw);
  const input = await stepInput(ctx, o.input ?? step.input, raw, scope);
  const warnings = await emptyRefs(ctx, o.input ?? step.input, raw, scope);
  const pin = definition.pins?.[step.id] as Pin | undefined;
  // A pinned stop.* step stops the path on purpose: expected outcome.
  if (pin && step.type.startsWith("stop.")) {
    const message =
      pin.error ??
      String((step.input as { message?: unknown } | undefined)?.message ?? "");
    return {
      input,
      warnings,
      result: { branch: "stop", output: { stopped: message } } as BlockResult,
      simulated: false,
      pinned: true,
      reason: errorItem("workflows.reasonStopped", "stops the run: {message}", {
        message,
      }),
    };
  }
  if (pin?.error !== undefined) {
    const branches = branchesOf(step, block);
    if (!branches.includes("error"))
      throw appError("workflows.pinnedError", "{step}: pinned error: {error}", {
        step: step.id,
        error: pin.error,
      });
    return {
      input,
      warnings,
      result: { branch: "error", output: { error: pin.error } } as BlockResult,
      simulated: false,
      pinned: true,
      reason: errorItem("workflows.reasonPinned", "pinned output"),
    };
  }
  if (pin)
    return {
      input,
      warnings,
      result: {
        branch: pin.branch ?? branchesOf(step, block)[0] ?? "ok",
        output: pin.output,
      } as BlockResult,
      simulated: false,
      pinned: true,
      reason: errorItem("workflows.reasonPinned", "pinned output"),
    };
  const parsed = block.inputSchema.parse(input);
  // Like validate: a missing secret makes a continueOnFail step take its
  // error branch; otherwise the path fails.
  const missing = !o.live && (await missingSecret(ctx, step));
  if (missing) {
    const error = `Missing secret ${missing}`;
    if (!step.retry?.continueOnFail)
      throw appError("workflows.missingSecret", "Missing secret {name}", {
        name: missing,
      });
    return {
      input,
      warnings,
      result: { branch: "error", output: { error } } as BlockResult,
      simulated: false,
      pinned: false,
      reason: errorItem(
        "workflows.reasonContinueOnFail",
        "failed, continued: {error}",
        { error },
      ),
    };
  }
  // Function: its inputSchema is checked on the rendered input (ref
  // resolving to undefined…), readable error. Without network access it
  // runs like functions.test { dryRun: true }: real reads, record and
  // event writes simulated and listed in `writes`.
  let fn: FunctionRow | undefined;
  if (step.type.startsWith("fn.")) {
    const { name, version } = fnName(step.type);
    const f = await functionsService.get(ctx, name, version);
    if (f) {
      validateSchema(f.inputSchema as Record<string, unknown>, input, "input");
      const perms = f.permissions as { domains?: string[] };
      if (!perms.domains?.length) fn = f;
    }
  }
  if (step.type === "human.approve")
    return {
      input,
      warnings,
      result: null,
      simulated: true,
      pinned: false,
      reason: errorItem(
        "workflows.reasonAwaitingApproval",
        "awaiting human approval",
      ),
    };
  const simulated =
    !o.live &&
    ((block.sideEffect && !fn) || (!o.ai && step.type.startsWith("ai.")));
  if (simulated)
    return {
      input,
      warnings,
      result: block.simulate?.(parsed) ??
        (await syntheticWrite(ctx, step.type, parsed)) ?? {
          branch: branchesOf(step, block)[0] ?? "ok",
          output: null,
        },
      simulated,
      pinned: false,
      reason: errorItem(
        "workflows.reasonSimulated",
        "simulated (no side effects)",
      ),
    };
  // Real AI: cap and budget applied as in a run.
  const ai = step.type.startsWith("ai.");
  let result: BlockResult;
  const writes: PlannedWrite[] | undefined = fn && !o.live ? [] : undefined;
  try {
    if (ai) await assertAiAllowed(ctx);
    result =
      fn && writes
        ? await runFunctionDry(ctx, fn, parsed, block.branches, writes)
        : await block.run(
            parsed,
            blockContext(ctx, 0, {
              scope: { ...scope },
              engine: blockEngine(ctx),
            }),
          );
  } catch (e) {
    // stop.* ends the path on purpose (expected outcome of a branch): it
    // is recorded in the trace, not reported as a failing path.
    if (e instanceof StopError)
      return {
        input,
        warnings,
        result: {
          branch: "stop",
          output: { stopped: e.message },
        } as BlockResult,
        simulated: false,
        pinned: false,
        reason: errorItem(
          "workflows.reasonStopped",
          "stops the run: {message}",
          { message: e.message },
        ),
      };
    // Like the engine: continueOnFail turns the failure into { error }.
    if (!step.retry?.continueOnFail) throw e;
    const error = (e as Error).message;
    return {
      input,
      warnings,
      result: { branch: "error", output: { error } } as BlockResult,
      simulated: false,
      pinned: false,
      reason: errorItem(
        "workflows.reasonContinueOnFail",
        "failed, continued: {error}",
        { error },
      ),
    };
  }
  if (ai) await chargeAi(ctx, result.cost);
  const out = result.output as { reason?: string } | null;
  return {
    input,
    warnings,
    result,
    simulated,
    ...(writes && { writes }),
    pinned: false,
    reason:
      typeof out?.reason === "string"
        ? errorItem("switch.matched", "{reason}", { reason: out.reason })
        : errorItem("workflows.reasonBranch", "branch {branch}", {
            branch: result.branch,
          }),
  };
}

// Function run with dry-run semantics (functions.test { dryRun: true }):
// same branch and failure convention as the fn.* block.
async function runFunctionDry(
  ctx: TenantContext,
  f: FunctionRow,
  input: unknown,
  branches: readonly string[] | undefined,
  writes: PlannedWrite[],
): Promise<BlockResult> {
  const perms = f.permissions as { secrets?: string[] };
  const { output } = await runLogged(ctx, f, input, {
    source: "test",
    secrets: perms.secrets?.length ? await decryptAll(ctx) : {},
    writes,
  });
  const res = output as { branch?: unknown; ok?: unknown; error?: unknown };
  if (res && typeof res === "object" && res.ok === false)
    throw appError("workflows.functionFailed", "{fn}: {error}", {
      fn: f.name,
      error:
        typeof res.error === "string"
          ? res.error
          : (JSON.stringify(res.error) ?? "returned ok: false"),
    });
  return {
    branch:
      typeof res?.branch === "string" ? res.branch : (branches?.[0] ?? "ok"),
    output,
  };
}

// First secret a step needs that is not set: `{{secret.X}}` refs,
// `input.secret`, and the function's permissions.secrets.
async function missingSecret(ctx: TenantContext, step: Step) {
  const input = (step.input ?? {}) as Record<string, unknown>;
  const needed = new Set<string>();
  for (const ref of templatePaths(input)) {
    const [root, name] = ref.split(".");
    if (root === "secret" && name) needed.add(name);
  }
  if (
    step.type === "webhook.emit" &&
    typeof input.secret === "string" &&
    !input.secret.includes("{{")
  )
    needed.add(input.secret);
  if (step.type.startsWith("fn.")) {
    const { name, version } = fnName(step.type);
    const f = await functionsService.get(ctx, name, version);
    const perms = (f?.permissions ?? {}) as { secrets?: string[] };
    for (const s of perms.secrets ?? []) needed.add(s);
  }
  if (!needed.size) return undefined;
  const defined = new Set((await secretsService.list(ctx)).map((x) => x.name));
  return [...needed].find((n) => !defined.has(n));
}

const empty = (v: unknown) => v === undefined || v === null || v === "";

// Simulated record writes return a synthetic record (fresh id, the written
// data with field defaults) so that later {{steps.x.output.record.id}} refs
// resolve. The checks of a real write that do not need the database apply:
// an upsert without key, or with an empty match value, fails here too.
async function syntheticWrite(
  ctx: TenantContext,
  type: string,
  input: unknown,
): Promise<BlockResult | null> {
  // Simulated event: same output shape as a real emit.
  if (type === "event.emit")
    return {
      branch: "ok",
      output: { eventId: "dry", id: "dry", duplicate: false },
    };
  if (type !== "record.upsert" && type !== "record.create") return null;
  const i = input as {
    object?: string;
    data?: Record<string, unknown>;
    match?: string;
    externalId?: string;
  };
  const written = i.data ?? {};
  if (type === "record.upsert" && !i.externalId) {
    if (!i.match)
      throw appError(
        "blocks.matchOrExternalIdRequired",
        "match or externalId required",
      );
    if (empty(written[i.match]))
      throw appError(
        "records.matchValueRequired",
        "match: value required ({field})",
        { field: i.match },
      );
  }
  const object = i.object ? await objectsService.get(ctx, i.object) : null;
  const data = withDefaults((object?.fields ?? []) as Field[], written);
  const record = { ...data, id: crypto.randomUUID(), data, dryRun: true };
  return type === "record.create"
    ? { branch: "ok", output: { record } }
    : {
        branch: "created",
        output: { record, created: true, changed: Object.keys(data) },
      };
}

// Refs of a step input that render empty: {{record.*}} (missing field),
// {{event.*}} (absent from the payload), {{steps.*}} (absent or simulated
// null output), {{run.*}} (null in a dry run, set in a real run). A
// warning, since the real run would write or send blanks.
async function emptyRefs(
  ctx: TenantContext,
  input: unknown,
  raw: Set<string>,
  scope: Scope,
) {
  const kept = Object.fromEntries(
    Object.entries((input ?? {}) as Record<string, unknown>).filter(
      ([k]) => !raw.has(k),
    ),
  );
  const out: ErrorItem[] = [];
  for (const ref of templatePaths(kept)) {
    const kind = /^(record|event|steps|run)\./.exec(ref)?.[1];
    if (!kind) continue;
    const v = await renderInputs(ctx, `{{${ref}}}`, scope);
    if (!empty(v)) continue;
    if (kind === "record")
      out.push(
        errorItem(
          "workflows.dryRunEmptyRecordRef",
          "`{ref}` renders empty: the record has no value for this field",
          { ref },
        ),
      );
    else if (kind === "run")
      out.push(
        errorItem(
          "workflows.dryRunSimulatedRunRef",
          "`{ref}` is null in a dry run; a real run sets it (use runs.start { test: true } to check it)",
          { ref },
        ),
      );
    else
      out.push(
        errorItem(
          "workflows.dryRunEmptyRef",
          "`{ref}` renders empty in this dry run: check the path (pin the step output or pass `event`)",
          { ref },
        ),
      );
  }
  return out;
}

type Synthetic = Record<string, unknown> & { id: string };
type Targets = {
  recordIds: string[];
  event?: unknown;
  // Record the webhook mapping would upsert (nothing is written).
  synthetic?: Synthetic;
  // Nothing to run on: the dry run cannot mark the version tested.
  skipped?: ErrorItem;
  // Findings on the provided event (shape unlike the real payload).
  warnings?: ErrorItem[];
};

// What a dry run without `records` runs on, like the real trigger:
// webhook = stored sample mapped to a synthetic record; schedule on an
// object = a sample of the records matching its filter.
export async function dryRunTargets(
  ctx: TenantContext,
  definition: Definition,
  recordIds: string[],
  opts: DryRunOptions,
): Promise<Targets> {
  const t = triggerSchema.safeParse(definition.trigger).data;
  if (t?.type === "trigger.event" && opts.event !== undefined) {
    const warnings = await eventShape(ctx, t.event, opts.event);
    return { recordIds, event: opts.event, warnings };
  }
  if (recordIds.length || !t) return { recordIds, event: opts.event };
  if (t.type === "trigger.event" && opts.event === undefined)
    throw appError(
      "workflows.dryRunEventMissing",
      'This workflow starts on event {type}: pass `event` (the event payload, e.g. events.list { type: "{type}" } for a real one) or `events` for one run per payload, or `records` to run on records',
      { type: t.event },
      { kind: "invalid_input" },
    );
  if (t.type === "trigger.webhook") {
    const hook = (await webhooksService.list(ctx)).find(
      (h) => h.name === t.webhook || h.id === t.webhook,
    );
    const sample = hook?.sample ?? undefined;
    let event = opts.event;
    if (event === undefined) {
      if (sample === undefined || sample === null)
        return {
          recordIds,
          skipped: errorItem(
            "workflows.dryRunNoSample",
            "Webhook {webhook} has no stored sample: call its testPath (or webhooks.test) first, or pass `event` with the provider payload",
            { webhook: t.webhook },
          ),
        };
      event = sample;
    } else if (sample && t.mapping) {
      const missing = Object.values(t.mapping).filter(
        (p) => pick(sample, p) !== undefined && pick(event, p) === undefined,
      );
      if (missing.length)
        throw appError(
          "workflows.dryRunEventShape",
          "`event` does not match the stored sample of webhook {webhook}: paths {paths} are missing. Pass the raw provider payload (same shape as the sample), not a record",
          { webhook: t.webhook, paths: missing.join(", ") },
          { kind: "invalid_input" },
        );
    }
    if (!t.object || !t.mapping) return { recordIds, event };
    const data: Record<string, unknown> = {};
    for (const [field, p] of Object.entries(t.mapping)) {
      const v = pick(event, p);
      if (v !== undefined && v !== null && v !== "") data[field] = v;
    }
    const object = await objectsService.get(ctx, t.object);
    const fields = (object?.fields ?? []) as Field[];
    const blanks = Object.fromEntries(fields.map((f) => [f.key, null]));
    Object.assign(data, withDefaults(fields, data));
    const synthetic: Synthetic = {
      ...blanks,
      ...data,
      id: crypto.randomUUID(),
      objectId: object?.id ?? null,
      data,
      dryRun: true,
    };
    const withId =
      event && typeof event === "object" && !Array.isArray(event)
        ? { recordId: synthetic.id, ...event }
        : event;
    return { recordIds, event: withId, synthetic };
  }
  if (t.type === "trigger.schedule" && t.object) {
    const object = await objectsService.get(ctx, t.object);
    const records = object
      ? await recordsService.search(ctx, object.id, {
          filter: t.filter,
          pagination: { limit: SCHEDULE_SAMPLE },
        })
      : [];
    if (!records.length)
      return {
        recordIds,
        event: opts.event,
        skipped: errorItem(
          "workflows.dryRunNoScheduleRecords",
          "No {object} record matches the schedule filter, so there is nothing to run on. Add a matching record (test: true) or pass `records`",
          { object: t.object },
        ),
      };
    return { recordIds: records.map((r) => r.id), event: opts.event };
  }
  return { recordIds, event: opts.event };
}

// {{event}} is the payload itself: an `event` wrapped in { payload } (or
// with keys unlike the latest received event of that type) renders every
// {{event.x}} empty in a real run.
async function eventShape(ctx: TenantContext, type: string, event: unknown) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return [];
  const keys = Object.keys(event);
  const latest = (await eventsService.list(ctx, { type, limit: 1 })).items[0];
  const sample = latest?.payload as Record<string, unknown> | undefined;
  const sampleKeys =
    sample && typeof sample === "object" ? Object.keys(sample) : null;
  if (keys.includes("payload") && !sampleKeys?.includes("payload"))
    return [
      errorItem(
        "workflows.dryRunEventPayloadKey",
        "`event` has a top-level `payload` key, but the event variable is the payload itself: pass its content directly",
      ),
    ];
  if (sampleKeys?.length && !keys.some((k) => sampleKeys.includes(k)))
    return [
      errorItem(
        "workflows.dryRunEventSampleShape",
        "`event` shares no key with the latest {type} event ({keys}): pass the same shape",
        { type, keys: sampleKeys.slice(0, 10).join(", ") },
      ),
    ];
  return [];
}

// Steps whose simulated output is null and that `step` reads: the usual
// cause of a dry-run failure that a real run would not have.
function nullRefs(
  step: Step | undefined,
  done: Record<string, { output: unknown }>,
) {
  const raw = JSON.stringify(step?.input ?? {});
  return Object.entries(done)
    .filter(([id, v]) => v.output == null && raw.includes(`steps.${id}.`))
    .map(([id]) => id);
}

const baseScope = (
  record: unknown,
  o: DryRunOptions,
  steps: Record<string, { output: unknown }> = {},
): Scope => ({
  record,
  ...(o.event !== undefined && { event: o.event }),
  depth: 0,
  ...builtins({ workflowId: o.workflowId }),
  steps,
});

// Runs the workflow without side effects, on each record (or once without
// record if `recordIds` is empty, with the provided event): real reads,
// writes / sends / writing functions simulated, nothing is persisted.
// AI blocks simulated unless `ai: true` (real, paid call). Pinned outputs
// (`pins`) replayed. Several targets (or entries) = as many paths, like
// the engine; a `join` step runs once when the other paths have
// finished, with the outputs of all. `path`: all steps flat
// (compatibility), `paths`: one per path; each step carries input and output.
export async function dryRun(
  ctx: TenantContext,
  definition: Definition,
  recordIds: string[],
  opts: DryRunOptions = {},
): Promise<DryRunResult[]> {
  const steps = definition.steps as (Step & { join?: boolean })[];
  const { entry, next } = normalizeGraph(definition);
  const targets = await dryRunTargets(ctx, definition, recordIds, opts);
  if (targets.skipped)
    return [
      {
        recordId: null,
        path: [] as DryRunStep[],
        paths: [] as DryRunPath[],
        skipped: targets.skipped.message,
        skippedItem: targets.skipped,
      },
    ];
  opts = { ...opts, event: targets.event };
  const eventWarnings = (targets.warnings ?? []).map((w) => w.message);
  const results: DryRunResult[] = [];
  for (const recordId of targets.recordIds.length
    ? targets.recordIds
    : [null]) {
    const record = recordId
      ? await recordsService.get(ctx, recordId)
      : (targets.synthetic ?? null);
    const paths: DryRunPath[] = [];
    const flat: DryRunStep[] = [];
    // Queue of paths: id, current step, known outputs of the path.
    type Todo = {
      id: string;
      stepId: string | undefined;
      done: Record<string, { output: unknown }>;
      path: DryRunPath | undefined;
    };
    const ids = (n: number, base?: string) =>
      Array.from({ length: n }, (_, i) =>
        n === 1 && base !== undefined ? base : base ? `${base}.${i}` : `${i}`,
      );
    const todo: Todo[] = entry.map((stepId, i) => ({
      id: ids(entry.length)[i]!,
      stepId,
      done: {},
      path: undefined,
    }));
    // Paths that reached a `join` step, waiting for the others.
    const joined = new Map<string, Todo[]>();
    const isJoin = (id: string) => steps.some((s) => s.id === id && s.join);
    while (todo.length || joined.size) {
      if (!todo.length) {
        // No active path anymore: the first path that arrived runs the join
        // with the outputs of all.
        const [stepId, waiting] = [...joined][0]!;
        joined.delete(stepId);
        todo.push({
          ...waiting[0]!,
          done: Object.assign({}, ...waiting.map((w) => w.done)),
        });
      }
      const cur = todo.shift()!;
      const path = cur.path ?? { id: cur.id, steps: [] };
      if (!cur.path) paths.push(path);
      if (!cur.stepId) continue;
      if (flat.length >= MAX_STEPS) {
        path.error = `Limit of ${MAX_STEPS} steps reached`;
        continue;
      }
      const step = steps.find((s) => s.id === cur.stepId);
      try {
        if (!step)
          throw notFound("workflows.unknownStep", "step {id} does not exist", {
            id: cur.stepId,
          });
        const r = await execStep(
          ctx,
          definition,
          step,
          baseScope(record, opts, cur.done),
          { ai: opts.ai },
        );
        const full: DryRunStep = {
          stepId: step.id,
          type: step.type,
          ...(r.result && { branch: r.result.branch }),
          simulated: r.simulated,
          reason: r.reason.message,
          reasonItem: r.reason,
          path: path.id,
          input: r.input,
          output: r.result?.output ?? null,
          ...(r.pinned && { pinned: true }),
          ...("writes" in r && r.writes && { writes: r.writes }),
          ...(r.warnings.length && {
            warnings: r.warnings.map((w) => w.message),
          }),
        };
        path.steps.push(full);
        flat.push(full);
        if (!r.result) {
          if (step.type === "human.approve")
            path.hint = errorItem(
              "workflows.dryRunApprovalHint",
              'The path stops at {step} (awaiting a human decision). Pin its branch to test what follows: definition.pins = { "{step}": { branch: "approved" } } (or "rejected", "expired")',
              { step: step.id },
            ).message;
          continue;
        }
        const done = { ...cur.done, [step.id]: { output: r.result.output } };
        let targets = next[step.id]?.[r.result.branch] ?? [];
        // continueOnFail without a connected error branch: first branch.
        if (
          r.result.branch === "error" &&
          !targets.length &&
          step.retry?.continueOnFail
        ) {
          const block = await getBlock(ctx, step.type);
          const first = block ? branchesOf(step, block)[0] : undefined;
          targets = (first && next[step.id]?.[first]) || [];
        }
        const childIds = ids(targets.length, path.id);
        const children: Todo[] = targets.map((stepId, i) => ({
          id: childIds[i]!,
          stepId,
          done,
          // A single target: the path continues; otherwise it splits.
          path: targets.length === 1 ? path : undefined,
        }));
        for (const c of children.filter((c) => isJoin(c.stepId!)))
          joined.set(c.stepId!, [...(joined.get(c.stepId!) ?? []), c]);
        todo.unshift(...children.filter((c) => !isJoin(c.stepId!)));
      } catch (e) {
        path.error = `${cur.stepId} : ${(e as Error).message}`;
        const [nul] = nullRefs(step, cur.done);
        if (nul)
          path.hint = errorItem(
            "workflows.dryRunPinHint",
            'Step {step} is simulated in dry run and outputs null, so refs to it are empty. Pin a sample output: definition.pins = { "{step}": { output: { ... } } }, or use a test run (runs.start { test: true })',
            { step: nul },
          ).message;
      }
    }
    const failed = paths.find((p) => p.error);
    const stop = stoppedAtCondition(flat, next);
    const untested = stop?.untested;
    const warnings = [
      ...new Set([
        ...eventWarnings,
        ...flat.flatMap((s) => s.warnings ?? []),
        ...(stop?.warning ? [stop.warning] : []),
      ]),
    ];
    const coverage = coverageOf(steps, [flat]);
    results.push({
      recordId,
      path: flat,
      paths,
      ...(failed && { error: failed.error }),
      ...(failed?.hint && { hint: failed.hint }),
      ...(warnings.length && { warnings }),
      ...(targets.synthetic && { record: targets.synthetic }),
      coverage,
      ...(untested && { untested }),
    });
  }
  return results;
}

// Steps reached across runs, out of all steps.
export function coverageOf(
  steps: Step[],
  runs: { stepId: string }[][],
): Coverage {
  const ran = new Set(runs.flat().map((s) => s.stepId));
  const unreached = steps.map((s) => s.id).filter((id) => !ran.has(id));
  return {
    ran: steps.length - unreached.length,
    total: steps.length,
    unreached,
  };
}

// A run whose first condition (or switch) is its last step although that
// step has connected branches: nothing behind the filter was exercised.
// The pin hint names a connected branch the run did not take. A branch
// declared empty on purpose (`false: []`) is a deliberate end: warning.
function stoppedAtCondition(
  flat: DryRunStep[],
  next: Record<string, Record<string, string[]>>,
): { untested?: string; warning?: string } | undefined {
  const i = flat.findIndex(
    (s) => s.type === "condition" || s.type === "switch",
  );
  if (i < 0 || i < flat.length - 1) return undefined;
  const c = flat[i]!;
  const connected = Object.entries(next[c.stepId] ?? {})
    .filter(([, t]) => t.length)
    .map(([b]) => b);
  if (!connected.length) return undefined;
  if (c.branch !== undefined && next[c.stepId]?.[c.branch]?.length === 0)
    return {
      warning: errorItem(
        "workflows.dryRunDeliberateEnd",
        "{step} took branch {branch}, declared empty: the run ends there on purpose and nothing after {step} was exercised by this run",
        { step: c.stepId, branch: c.branch },
      ).message,
    };
  const fallback = c.type === "switch" ? "else" : "true";
  const pin =
    connected.find((b) => b !== c.branch && b !== "error") ?? fallback;
  return {
    untested: errorItem(
      "workflows.dryRunStoppedAtCondition",
      'Nothing ran after {step} (branch {branch}): pass `records` that take a connected branch, or pin it: definition.pins = { "{step}": { branch: "{pin}" } }',
      { step: c.stepId, branch: c.branch ?? "none", pin },
    ).message,
  };
}

// Side-effect steps (writes, sends) that no dry run reached, except those
// reached only through error branches (failure handling, hard to force).
export async function unreachedWrites(
  ctx: TenantContext,
  steps: Step[],
  next: Record<string, Record<string, string[]>>,
  unreached: string[],
) {
  const out: string[] = [];
  for (const id of unreached) {
    const s = steps.find((x) => x.id === id);
    if (!s || !(await getBlock(ctx, s.type))?.sideEffect) continue;
    const incoming = Object.values(next).flatMap((byBranch) =>
      Object.entries(byBranch)
        .filter(([, t]) => t.includes(id))
        .map(([b]) => b),
    );
    if (incoming.length && incoming.every((b) => b === "error")) continue;
    out.push(id);
  }
  return out;
}

// Runs a single step with a provided input (or the definition's), in
// the context of a record and/or an event. Outputs of the other steps
// come from `steps` (provided) then from pinned outputs. Side effects
// simulated unless `live: true` (real execution: writes, sends, paid AI).
export async function testStep(
  ctx: TenantContext,
  definition: Definition,
  stepId: string,
  o: DryRunOptions & {
    input?: unknown;
    recordId?: string;
    steps?: Record<string, unknown>;
    live?: boolean;
  } = {},
) {
  const step = (definition.steps as Step[]).find((s) => s.id === stepId);
  if (!step)
    throw notFound("workflows.unknownStep", "step {id} does not exist", {
      id: stepId,
    });
  // A live step test writes like a test run: records and events it
  // creates are flagged isTest (workspace.purge_test removes them).
  if (o.live) ctx = { ...ctx, test: true };
  const record = o.recordId ? await recordsService.get(ctx, o.recordId) : null;
  const known = {
    ...Object.fromEntries(
      Object.entries(definition.pins ?? {}).map(([id, p]) => [
        id,
        { output: (p as Pin).output },
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(o.steps ?? {}).map(([id, output]) => [id, { output }]),
    ),
  };
  const r = await execStep(ctx, definition, step, baseScope(record, o, known), {
    ai: o.ai || o.live,
    live: o.live,
    input: o.input,
  });
  return {
    stepId,
    type: step.type,
    input: r.input,
    branch: r.result?.branch ?? null,
    output: r.result?.output ?? null,
    simulated: r.simulated,
    pinned: r.pinned,
    reason: r.reason.message,
    reasonItem: r.reason,
    ...(o.live && { test: true }),
    ...(r.warnings.length && { warnings: r.warnings.map((w) => w.message) }),
  };
}
