// Fairness of BullMQ queues between workspaces, without BullMQ Pro.
// Round-robin scheduling by rank: each job gets as BullMQ priority
// its rank in its workspace backlog (1st pending job of the tenant = 2,
// 2nd = 3…). BullMQ serves increasing priorities, FIFO at equal priority:
// the heads of all tenants' queues go first, then the 2nd ones, etc. A tenant
// with 10,000 jobs thus only takes one turn out of two against a tenant with 10 jobs.
// Manual and test runs: priority 1, ahead of their tenant's backlog.
// Concurrency capped per workspace: a job taken while its tenant already has
// `cap` active jobs is put back on hold (increasing delay).
// Callers' job ids (deduplication) and options are preserved.
import {
  DelayedError,
  type Job,
  type JobsOptions,
  type Queue,
} from "bullmq";
import type { Redis } from "ioredis";
import { busConnection, queuePrefix } from "../bus";
import { tenantConcurrency } from "../quotas";

// Maximum priority accepted by BullMQ.
export const MAX_PRIORITY = 2_097_151;
// Rank of priority jobs (manual, test): ahead of any backlog.
export const URGENT_PRIORITY = 1;

// Priority of a job based on the number of jobs already pending for its tenant.
export function fairPriority(pending: number, urgent = false) {
  if (urgent) return URGENT_PRIORITY;
  return Math.min(Math.max(pending, 0) + URGENT_PRIORITY + 1, MAX_PRIORITY);
}

// Delay before offering a refused job again (tenant at its cap): grows with
// the number of takes, so the backlog does not spin in a loop.
export function bounceDelay(started: number) {
  return Math.min(250 * 2 ** Math.min(Math.max(started - 1, 0), 7), 30_000);
}

// Lease of a concurrency slot, renewed while the job runs: a
// killed worker frees its slots on expiry.
const LEASE_MS = 3 * 60_000;
// Backlog counter: expires without activity (bounded leak if jobs are
// deleted without being processed).
const PENDING_TTL_MS = 3_600_000;

type FairData = { workspaceId: string; fq?: 1 };

let redis: Redis | undefined;
const conn = () => (redis ??= busConnection());
const key = (queue: string, kind: "pending" | "slots", ws: string) =>
  `${queuePrefix()}:fair:${queue}:${kind}:${ws}`;

// Adds a job at its rank. `urgent`: manual or test run. A delayed job
// does not count in the backlog (it is not ready yet); it takes the current
// rank for when its delay ends.
export async function fairAdd<D extends FairData, N extends string>(
  queue: Queue<D, unknown, N>,
  name: N,
  data: D,
  opts: JobsOptions = {},
  urgent = false,
) {
  const k = key(queue.name, "pending", data.workspaceId);
  const counted = !urgent && !opts.delay;
  let pending: number;
  if (counted) {
    const [[, n]] = (await conn()
      .multi()
      .incr(k)
      .pexpire(k, PENDING_TTL_MS)
      .exec()) as [[unknown, number]];
    pending = n - 1;
  } else pending = Number(await conn().get(k)) || 0;
  // `fq` inherited from a parent job (copied data): recomputed here.
  const rest: Omit<D, "fq"> & { fq?: 1 } = { ...data };
  delete rest.fq;
  return queue.add(
    name as never,
    (counted ? { ...rest, fq: 1 } : rest) as never,
    { ...opts, priority: fairPriority(pending, urgent) },
  );
}

// Takes a tenant slot (purging expired leases): 1 if granted.
const ACQUIRE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
local held = redis.call('ZSCORE', KEYS[1], ARGV[1])
if (not held) and redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then
  return 0
end
redis.call('ZADD', KEYS[1], tonumber(ARGV[2]) + tonumber(ARGV[3]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1`;

// Decrements the backlog without going below zero.
const RELEASE_PENDING = `
local n = redis.call('DECR', KEYS[1])
if n < 0 then redis.call('SET', KEYS[1], 0, 'PX', ARGV[1]) end
return n`;

export async function acquireSlot(
  queue: string,
  workspaceId: string,
  jobId: string,
  cap: number,
) {
  const ok = await conn().eval(
    ACQUIRE,
    1,
    key(queue, "slots", workspaceId),
    jobId,
    Date.now(),
    LEASE_MS,
    cap,
  );
  return ok === 1;
}

export const releaseSlot = (queue: string, workspaceId: string, jobId: string) =>
  conn().zrem(key(queue, "slots", workspaceId), jobId);

// Wraps a BullMQ processor: leaves the backlog on the first take,
// tenant slot taken for the job duration, otherwise put back on hold.
// `cap`: workspace cap (default: the workspace `concurrency` limit).
export function fairProcessor<D extends FairData, R, N extends string>(
  fn: (job: Job<D, R, N>) => Promise<R>,
  cap: (workspaceId: string) => Promise<number> = tenantConcurrency,
) {
  return async (job: Job<D, R, N>, token?: string): Promise<R> => {
    const ws = job.data.workspaceId;
    const id = job.id!;
    if (job.data.fq && job.attemptsStarted <= 1)
      await conn().eval(
        RELEASE_PENDING,
        1,
        key(job.queueName, "pending", ws),
        PENDING_TTL_MS,
      );
    if (!(await acquireSlot(job.queueName, ws, id, await cap(ws)))) {
      await job.moveToDelayed(
        Date.now() + bounceDelay(job.attemptsStarted),
        token,
      );
      throw new DelayedError();
    }
    const renew = setInterval(
      () =>
        void acquireSlot(job.queueName, ws, id, Number.MAX_SAFE_INTEGER).catch(
          () => {},
        ),
      LEASE_MS / 3,
    );
    try {
      return await fn(job);
    } finally {
      clearInterval(renew);
      await releaseSlot(job.queueName, ws, id).catch(() => {});
    }
  };
}
