// Dry run of a workflow and single-step test (no side effects by default).
import { getBlock, blockContext, type BlockResult } from "../blocks";
import { blockEngine } from "../blocks/engine";
import { assertAiAllowed, chargeAi } from "../runs/budget";
import { recordsService } from "../records";
import { builtins, stepInput } from "../runs/templates";
import type { TenantContext } from "../tenant";
import type { Definition } from "./index";
import { normalizeGraph } from "./graph";
import { errorItem, notFound, type ErrorItem } from "../errors/app-error";
import { functionsService } from "../functions";
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
};
export type DryRunPath = { id: string; steps: DryRunStep[]; error?: string };

// Pinned output of a step (`definition.pins[stepId]`): replayed in dry run and
// in step tests instead of running the block (frozen sample data).
export type Pin = { output: unknown; branch?: string };

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
  const pin = definition.pins?.[step.id] as Pin | undefined;
  if (pin)
    return {
      input,
      result: {
        branch: pin.branch ?? branchesOf(step, block)[0] ?? "ok",
        output: pin.output,
      } as BlockResult,
      simulated: false,
      pinned: true,
      reason: errorItem("workflows.reasonPinned", "pinned output"),
    };
  const parsed = block.inputSchema.parse(input);
  // Simulated function (side effect): its inputSchema is still checked
  // on the rendered input (ref resolving to undefined…), readable error.
  if (step.type.startsWith("fn.")) {
    const { name, version } = fnName(step.type);
    const f = await functionsService.get(ctx, name, version);
    if (f)
      validateSchema(f.inputSchema as Record<string, unknown>, input, "input");
  }
  if (step.type === "human.approve")
    return {
      input,
      result: null,
      simulated: true,
      pinned: false,
      reason: errorItem(
        "workflows.reasonAwaitingApproval",
        "awaiting human approval",
      ),
    };
  const simulated =
    !o.live && (block.sideEffect || (!o.ai && step.type.startsWith("ai.")));
  if (simulated)
    return {
      input,
      result: block.simulate?.(parsed) ?? {
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
  if (ai) await assertAiAllowed(ctx);
  const result = await block.run(
    parsed,
    blockContext(ctx, 0, { scope: { ...scope }, engine: blockEngine(ctx) }),
  );
  if (ai) await chargeAi(ctx, result.cost);
  const out = result.output as { reason?: string } | null;
  return {
    input,
    result,
    simulated,
    pinned: false,
    reason:
      typeof out?.reason === "string"
        ? errorItem("switch.matched", "{reason}", { reason: out.reason })
        : errorItem("workflows.reasonBranch", "branch {branch}", {
            branch: result.branch,
          }),
  };
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
) {
  const steps = definition.steps as (Step & { join?: boolean })[];
  const { entry, next } = normalizeGraph(definition);
  const results = [];
  for (const recordId of recordIds.length ? recordIds : [null]) {
    const record = recordId ? await recordsService.get(ctx, recordId) : null;
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
        };
        path.steps.push(full);
        flat.push(full);
        if (!r.result) continue;
        const done = { ...cur.done, [step.id]: { output: r.result.output } };
        const targets = next[step.id]?.[r.result.branch] ?? [];
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
      }
    }
    const error = paths.find((p) => p.error)?.error;
    results.push({ recordId, path: flat, paths, ...(error && { error }) });
  }
  return results;
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
  };
}
