// Internal event bus: mutations publish a BullMQ job,
// consumed by the worker. Record changes are also broadcast over
// Redis pub/sub (`ws:<id>:records`) for live page refresh.
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { TenantContext } from "../tenant";
import { fairAdd } from "../queues/fair";
import { env } from "../env";

export const BUS_QUEUE = "bus";

export type BusEvent =
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "event.received"
  // Failed run (id = run): fires trigger.run_failed.
  | "run.failed";

// Carries the tenant context of the actor behind the mutation.
export type BusJob = TenantContext & {
  id: string;
  // Record object (record.*): live filter.
  objectId?: string;
  changed?: string[];
  // event.emit chain depth: 0 outside workflows, +1 per bounce.
  depth?: number;
  // Unique id of the publication: the created runs carry its
  // trace, a replayed job (retry) does not create them twice.
  key?: string;
  // Follow-up or error retry: only this workflow is resolved.
  only?: string;
  // Follow-ups already queued for this trigger (active run on the record).
  followups?: number;
  // Counted in the tenant backlog (queues/fair).
  fq?: 1;
};

export const busConnection = () =>
  new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
  });

// BullMQ key prefix (QUEUE_PREFIX, default "bull"): a dedicated value
// isolates the queues of a test run (runbase-test-<pid>, see test-setup.ts)
// from dev/prod workers sharing the same Redis.
export const queuePrefix = () => env().QUEUE_PREFIX;
// Options shared by every BullMQ Queue/Worker.
export const queueOptions = () => ({
  connection: busConnection(),
  prefix: queuePrefix(),
});

let queue: Queue<BusJob, unknown, BusEvent> | undefined;
export const busQueue = () => (queue ??= new Queue(BUS_QUEUE, queueOptions()));

export type RecordChange = { objectId: string; id: string; kind: BusEvent };
export const recordsChannel = (workspaceId: string) =>
  `ws:${workspaceId}:records`;

let pub: Redis | undefined;
export async function publish(name: BusEvent, data: BusJob) {
  // Fairness between workspaces: rank in the tenant backlog.
  const job = await fairAdd(
    busQueue(),
    name,
    { key: randomUUID(), ...data },
    {
      // Transient outage (DB, Redis): replayed, no duplicate thanks to `key`.
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  );
  // Best-effort live broadcast: a pub/sub outage does not fail the mutation.
  if (data.objectId && name.startsWith("record."))
    await (pub ??= busConnection())
      .publish(
        recordsChannel(data.workspaceId),
        JSON.stringify({
          objectId: data.objectId,
          id: data.id,
          kind: name,
        } satisfies RecordChange),
      )
      .catch(() => {});
  return job;
}

// Subscription to a workspace's record changes. A single Redis subscriber
// per process, shared: channel -> callbacks, subscribe/unsubscribe
// reference-counted (one Redis connection whatever the number of SSE clients).
let sub: Redis | undefined;
const listeners = new Map<string, Set<(c: RecordChange) => void>>();
function subscriber() {
  if (sub) return sub;
  sub = busConnection();
  sub.on("error", () => {}); // reconnection handled by ioredis
  sub.on("message", (ch: string, msg: string) => {
    const fns = listeners.get(ch);
    if (!fns) return;
    let c: RecordChange;
    try {
      c = JSON.parse(msg) as RecordChange;
    } catch {
      return; // unreadable message ignored
    }
    fns.forEach((f) => f(c));
  });
  return sub;
}

export function subscribeRecords(
  workspaceId: string,
  onChange: (c: RecordChange) => void,
) {
  const channel = recordsChannel(workspaceId);
  const r = subscriber();
  let fns = listeners.get(channel);
  const first = !fns;
  if (!fns) listeners.set(channel, (fns = new Set()));
  fns.add(onChange);
  const ready = (first ? r.subscribe(channel) : Promise.resolve()).then(
    () => {},
    () => {}, // Redis outage: live disabled, no unhandled rejection
  );
  return {
    ready,
    close: () => {
      const set = listeners.get(channel);
      if (!set?.delete(onChange) || set.size) return;
      listeners.delete(channel);
      void r.unsubscribe(channel).catch(() => {});
    },
  };
}
