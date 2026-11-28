import { z } from "zod";
import { defineBlock, type Block } from "../block";
import { durationSchema, parseDuration } from "../duration";
import { LIST_MAX } from "./list";
import { appError } from "../../errors/app-error";

// Waits for a duration (`30s`, `15m`, `2h`, `3d`): the engine schedules the next
// step as a delayed BullMQ job, the run stays persisted in the database.
export const wait = defineBlock({
  type: "wait",
  label: "Wait",
  description: "Pauses the run for a duration.",
  sideEffect: false,
  inputSchema: z.object({ duration: durationSchema }),
  outputSchema: z.object({ until: z.string() }),
  branches: ["done"],
  run: async ({ duration }) => {
    const delayMs = parseDuration(duration);
    return {
      branch: "done",
      output: { until: new Date(Date.now() + delayMs).toISOString() },
      delayMs,
    };
  },
});

// Waits until a date (ISO): next step scheduled at that date; a past
// date continues immediately.
export const waitUntil = defineBlock({
  type: "wait.until",
  label: "Wait until a date",
  description: "Pauses the run until a specific date and time.",
  sideEffect: false,
  inputSchema: z.object({ until: z.iso.datetime({ offset: true }) }),
  outputSchema: z.object({ until: z.string() }),
  branches: ["done"],
  run: async ({ until }) => ({
    branch: "done",
    output: { until: new Date(until).toISOString() },
    delayMs: Math.max(0, new Date(until).getTime() - Date.now()),
  }),
});

// Pauses the run until a decision (UI or MCP); branches approved /
// rejected. `timeout`: without a decision within that delay, `expired` branch if it
// is connected, otherwise the path fails.
export const humanApprove = defineBlock({
  type: "human.approve",
  label: "Human approval",
  description:
    "Pauses the run until it is approved or rejected, with an optional timeout.",
  sideEffect: false,
  inputSchema: z.object({
    message: z.string().default(""),
    timeout: durationSchema.optional(),
  }),
  // Output of the decided step (runs.decide); while waiting, only `message`.
  outputSchema: z.object({
    message: z.string(),
    approved: z.boolean().optional(),
    by: z
      .object({
        userId: z.string().optional(),
        apiKeyId: z.string().optional(),
        scopes: z.array(z.string()),
        label: z.string().optional(),
      })
      .optional(),
    decidedAt: z.string().optional(),
    comment: z.string().optional(),
  }),
  branches: ["approved", "rejected", "expired"],
  run: async ({ message, timeout }) => ({
    branch: "",
    output: { message },
    pause: true,
    ...(timeout && { expireMs: parseDuration(timeout) }),
  }),
});

// Iterates a linear subgraph (`do`) over a list, capped at `limit`.
// `include`: relations loaded on each item (record), e.g. `entreprise`
// -> `{{item.included.entreprise}}`.
// Inside `do`, `{{item}}`, `{{index}}`, `{{steps.<id>.output}}` (steps of the iteration,
// then those of the run) and the run variables (`record`, `event`, `now`…). The
// `fn.*` functions and raw-input blocks (list.map…) are allowed there;
// no nested loop, wait or human approval.
// Each successful iteration is recorded (checkpoint): a retry of the step
// resumes at the failed iteration without redoing the previous ones.
type LoopState = {
  results: Record<string, unknown>[];
  iterations: { index: number; durationMs: number; cost: number }[];
  cost: number;
};

export const loop = defineBlock({
  type: "loop",
  label: "Loop",
  description: "Repeats a sequence of steps for each item of a list.",
  sideEffect: true,
  inputSchema: z.object({
    items: z.array(z.unknown()),
    limit: z.number().int().min(1).max(LIST_MAX).default(100),
    include: z.array(z.string().min(1)).optional(),
    do: z
      .array(z.object({ id: z.string(), type: z.string(), input: z.unknown() }))
      .min(1),
  }),
  outputSchema: z.object({
    results: z.array(z.record(z.string(), z.unknown())),
    // Per-iteration detail: duration and cost.
    iterations: z.array(
      z.object({ index: z.number(), durationMs: z.number(), cost: z.number() }),
    ),
    truncated: z.boolean(),
  }),
  branches: ["done"],
  raw: ["do"],
  // Dry run: no iteration, but an output of the right shape so the steps
  // after the loop can read `results`.
  simulate: () => ({
    branch: "done",
    output: { results: [], iterations: [], truncated: false },
  }),
  run: async ({ items, limit, include, do: steps }, ctx) => {
    const engine = ctx.engine;
    if (!engine)
      throw appError(
        "blocks.loopContextRequired",
        "loop: run context required",
      );
    const run = ctx.scope ?? {};
    const runSteps = (run.steps ?? {}) as Record<string, unknown>;
    const state: LoopState = ((await ctx.checkpoint?.load()) as
      LoopState | undefined) ?? { results: [], iterations: [], cost: 0 };
    const list = items.slice(0, limit);
    for (let index = state.results.length; index < list.length; index++) {
      const t0 = Date.now();
      const el = list[index];
      const id = (el as { id?: unknown } | null)?.id;
      const item =
        include?.length && typeof id === "string"
          ? await ctx.services.records.get(id, { include })
          : el;
      const out: Record<string, { output: unknown }> = {};
      let cost = 0;
      for (const s of steps) {
        const b: Block | undefined = await engine.getBlock(s.type);
        if (!b || b.type === "loop" || b.type === "human.approve")
          throw appError(
            "blocks.notInLoop",
            "Block cannot be used in a loop: {type}",
            { type: s.type },
          );
        const scope = {
          ...run,
          item,
          index,
          steps: { ...runSteps, ...out },
        };
        const raw = new Set(b.raw);
        let r;
        try {
          const input = await engine.stepInput(s.input, raw, scope);
          r = await b.run(b.inputSchema.parse(input), {
            ...ctx,
            key: ctx.key && `${ctx.key}:${index}:${s.id}`,
          });
        } catch (e) {
          throw appError(
            "blocks.iterationFailed",
            "Iteration {index}, step {step}: {message}",
            { index, step: s.id, message: (e as Error).message },
          );
        }
        if (r.pause || r.delayMs)
          throw appError(
            "blocks.notInLoop",
            "Block cannot be used in a loop: {type}",
            { type: s.type },
          );
        out[s.id] = { output: r.output };
        cost += r.cost ?? 0;
      }
      state.results.push(
        Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.output])),
      );
      state.iterations.push({ index, durationMs: Date.now() - t0, cost });
      state.cost += cost;
      await ctx.checkpoint?.save(state);
    }
    return {
      branch: "done",
      output: {
        results: state.results,
        iterations: state.iterations,
        truncated: items.length > limit,
      },
      cost: state.cost,
    };
  },
});
