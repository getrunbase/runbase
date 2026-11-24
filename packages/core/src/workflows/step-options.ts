// Execution options of a step, next to `input`: maximum timeout and
// retry policy. Default values: environment variables.
import { z } from "zod";
import { durationSchema, parseDuration } from "../blocks/duration";
import { env } from "../env";

export const stepOptionsSchema = z.object({
  // Maximum duration of one attempt (network calls included).
  timeout: durationSchema.optional(),
  retry: z
    .object({
      // Total attempts (1 = no retry).
      attempts: z.number().int().min(1).max(10).optional(),
      // Delay before the 1st retry, doubled on each attempt.
      backoff: durationSchema.optional(),
      // After the last failure, the run continues: `error` branch if it
      // is connected, otherwise the block's first branch.
      continueOnFail: z.boolean().optional(),
    })
    .optional(),
});

export function stepOptions(step: unknown) {
  const o = stepOptionsSchema.safeParse(step);
  const opts = o.success ? o.data : {};
  return {
    timeoutMs: opts.timeout
      ? parseDuration(opts.timeout)
      : env().STEP_TIMEOUT_MS,
    attempts: opts.retry?.attempts ?? 3,
    backoffMs: opts.retry?.backoff ? parseDuration(opts.retry.backoff) : 1000,
    continueOnFail: opts.retry?.continueOnFail ?? false,
  };
}
