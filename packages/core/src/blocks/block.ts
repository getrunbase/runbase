// Block contract and execution context.
import type { z } from "zod";
import { recordsService } from "../records";
import { objectsService } from "../objects";
import { eventsService } from "../events";
import type { TenantContext } from "../tenant";
import { workspaceSettings, type WorkspaceSettings } from "../workspaces";
import { AppError, type ErrorInfo } from "../errors/app-error";

// Services exposed to blocks, already bound to the tenant: never the raw DB.
const scopedServices = {
  records: recordsService,
  objects: objectsService,
  events: eventsService,
};
type Bind<S> = {
  [M in keyof S]: S[M] extends (ctx: TenantContext, ...a: infer A) => infer R
    ? (...a: A) => R
    : never;
};
export type BlockServices = {
  [K in keyof typeof scopedServices]: Bind<(typeof scopedServices)[K]>;
};

// Engine hooks injected by the caller that runs the block (run engine, dry
// run). Blocks that resolve other blocks (loop) or start workflows
// (workflow.run) go through them instead of importing runs/ or workflows/,
// which both depend on the block registry.
export type BlockEngine = {
  getBlock: (type: string) => Promise<Block | undefined>;
  // Step input rendered against the run scope, except the block's raw keys.
  stepInput: (
    input: unknown,
    raw: Set<string>,
    scope: Record<string, unknown>,
  ) => Promise<unknown>;
  // Starts a workflow of the workspace (id or name); null if unknown.
  startWorkflow: (
    workflow: string,
    opts: {
      recordId?: string;
      event?: unknown;
      depth: number;
      parent?: { runId: string; path: string; n: number; stepId?: string };
      idempotencyKey?: string;
    },
  ) => Promise<{ id: string; status: string } | null>;
};

export type BlockContext = {
  services: BlockServices;
  // Engine hooks (see BlockEngine); absent outside a run or a dry run.
  engine?: BlockEngine;
  // Workspace settings (domains, secrets, MCP) for external blocks.
  settings: () => Promise<WorkspaceSettings>;
  // Chain depth of the current run (event.emit loops).
  depth: number;
  // Aborted at the step timeout: pass it to every fetch.
  signal: AbortSignal;
  // Stable key of the step in the run (`<run>:<path>:<rank>`): makes
  // side effects idempotent on retry (event.emit).
  key?: string;
  // Run tenant: blocks that resolve other blocks (loop -> fn.*).
  tenant?: TenantContext;
  // Run variables (`record`, `event`, `steps`, `now`…): loop makes them
  // available in its steps.
  scope?: Record<string, unknown>;
  // Current step in the run (workflow.run: parent to resume).
  run?: { runId: string; path: string; n: number; stepId?: string };
  // Persisted step progress (loop): read back on retry.
  checkpoint?: {
    load: () => Promise<unknown>;
    save: (state: unknown) => Promise<void>;
  };
};

export function blockContext(
  ctx: TenantContext,
  depth = 0,
  extra: Partial<
    Pick<
      BlockContext,
      "signal" | "key" | "checkpoint" | "scope" | "run" | "engine"
    >
  > = {},
): BlockContext {
  const services = Object.fromEntries(
    Object.entries(scopedServices).map(([name, svc]) => [
      name,
      Object.fromEntries(
        Object.entries(svc).map(([m, fn]) => [
          m,
          (...a: unknown[]) => (fn as (...x: unknown[]) => unknown)(ctx, ...a),
        ]),
      ),
    ]),
  );
  return {
    services: services as BlockServices,
    settings: () => workspaceSettings(ctx),
    depth,
    signal: extra.signal ?? AbortSignal.timeout(5 * 60_000),
    key: extra.key,
    checkpoint: extra.checkpoint,
    tenant: ctx,
    scope: extra.scope,
    run: extra.run,
    engine: extra.engine,
  };
}

// `delayMs`: the next step is scheduled as a delayed job (wait).
// `pause`: the run waits for an external decision (human.approve), the branch
// is then provided by `runsService.decide`.
export type BlockResult<O extends z.ZodType = z.ZodType> = {
  branch: string;
  output: z.infer<O>;
  cost?: number;
  tokens?: { input: number; output: number };
  delayMs?: number;
  pause?: boolean;
  // With `pause`: delay after which the decision expires (`expired` branch).
  expireMs?: number;
};

// AI block cap exceeded: step in error, no retry. The cost
// already consumed stays accounted.
export class CostCapExceeded extends AppError {
  constructor(
    detail: string,
    readonly cost: number | undefined,
    readonly tokens: { input: number; output: number },
    info: ErrorInfo = { code: "blocks.costCapExceeded" },
  ) {
    super(info.code, `cost_cap_exceeded : ${detail}`, info.params);
  }
}

// Deliberate stop (stop.error): step in error, no new attempt.
export class StopError extends Error {}

export type BlockApp = { name: string; label: string; logo?: string };

export type Block<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> = {
  type: string;
  // Label and description shown in the editor and MCP;
  // `type` stays the technical identifier.
  label: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  // Possible outputs; `run` tells which one was taken.
  branches: readonly string[];
  // Input-dependent branches (e.g. one case per `switch` value).
  branchesFor?: (input: unknown) => string[];
  // Input keys left raw (not rendered by the engine), e.g. the `loop` subgraph.
  raw?: readonly string[];
  // Side effect (write, send, external call): mandatory, dry run
  // then simulates the block instead of executing it.
  sideEffect: boolean;
  // Deprecated: still executes (existing workflows keep working) but is
  // hidden from the MCP catalog and the editor picker. Value: replacement.
  deprecated?: string;
  // App the block belongs to (connector nodes): folder name, label and
  // optional logo as a data URL.
  app?: BlockApp;
  // Simulated result in dry run; by default, first branch and null output.
  simulate?: (input: z.infer<I>) => BlockResult<O>;
  run: (input: z.infer<I>, ctx: BlockContext) => Promise<BlockResult<O>>;
};

export const defineBlock = <I extends z.ZodType, O extends z.ZodType>(
  b: Block<I, O>,
) => b;
