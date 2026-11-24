// Execution engine: a run pins the workflow version; each step
// is a BullMQ job (retries + backoff) that runs the block, persists its
// output in `run_steps`, then follows `next[stepId][branch]`.
// Definition: steps = [{ id, type, input }]; `entry` (default: the first
// step) starts the run.
// Parallel paths: each entry, and each target when a branch has
// several, is an execution branch of the run (`paths`, one job per path:
// "0", "1", "0.1"…). The run is succeeded when all its paths are finished,
// failed if one of them failed (the others run to the end). Without `join`, two
// paths that converge on a step each run it. Step `join: true`:
// the paths that reach it wait (`joined`); when no path is
// active anymore, a single one runs it (the others are closed).
// Control: cancellation (canceled, frees the record), manual pause and
// resume, retry per step (attempts, backoff, continueOnFail), per-step timeout
// and global timeout, expiry of a human approval, resume from a step.
export {
  ACTIVE_RUN_STATUSES,
  CONCURRENCY_POLL_MS,
  MAX_STEPS,
  RUN_STATUSES,
  RUNS_QUEUE,
  RunAlreadyActive,
  releaseJoins,
  stepsScope,
  workerConcurrency,
  type ParentRef,
} from "./state";
export {
  OUTBOX_GRACE_MS,
  RUNS_SWEEP_QUEUE,
  runsQueue,
  startRunsSweeper,
  sweepRunOutbox,
} from "./outbox";
export {
  AI_LIMIT_MESSAGE,
  aiGate,
  assertAiAllowed,
  chargeAi,
  readBudget,
} from "./budget";
export { retryRun, runsService } from "./service";
export { processStep, startRunsWorker } from "./engine";
export { render } from "../blocks";
