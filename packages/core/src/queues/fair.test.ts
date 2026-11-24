// Queue fairness per workspace. Scheduler unit tests, then
// Redis integration (REDIS_URL) on disposable queues (QUEUE_PREFIX prefix).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { queueOptions } from "../bus";
import {
  bounceDelay,
  fairAdd,
  fairPriority,
  fairProcessor,
  MAX_PRIORITY,
  URGENT_PRIORITY,
} from "./fair";

after(() => setImmediate(() => process.exit(0)));

test("fairPriority: rank in the backlog, urgent first, bounded", () => {
  assert.equal(fairPriority(0), 2);
  assert.equal(fairPriority(9), 11);
  assert.equal(fairPriority(-3), 2);
  assert.equal(fairPriority(5, true), URGENT_PRIORITY);
  assert.equal(fairPriority(10_000_000), MAX_PRIORITY);
});

test("scheduler: round-robin between tenants (BullMQ simulation)", () => {
  // BullMQ serves the lowest priority, FIFO at equal priority.
  const pending: Record<string, number> = {};
  const queue: { ws: string; p: number; seq: number }[] = [];
  const add = (ws: string, urgent = false) => {
    const p = fairPriority(pending[ws] ?? 0, urgent);
    if (!urgent) pending[ws] = (pending[ws] ?? 0) + 1;
    queue.push({ ws, p, seq: queue.length });
  };
  for (let i = 0; i < 1000; i++) add("A");
  for (let i = 0; i < 10; i++) add("B");
  add("A", true);
  const order = [...queue].sort((x, y) => x.p - y.p || x.seq - y.seq);
  // A's urgent run goes first, then A and B alternate.
  assert.equal(order[0]!.p, URGENT_PRIORITY);
  const lastB = order.map((j) => j.ws).lastIndexOf("B");
  assert.ok(lastB <= 21, `dernier job de B en position ${lastB}`);
  assert.deepEqual(
    order.slice(1, 7).map((j) => j.ws),
    ["A", "B", "A", "B", "A", "B"],
  );
});

test("bounceDelay: increasing then capped", () => {
  assert.equal(bounceDelay(1), 250);
  assert.equal(bounceDelay(2), 500);
  assert.ok(bounceDelay(3) > bounceDelay(2));
  assert.equal(bounceDelay(100), 30_000);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Data = { workspaceId: string; i: number };

async function fill(q: Queue<Data>, ws: string, n: number, urgent = false) {
  for (let from = 0; from < n; from += 500)
    await Promise.all(
      Array.from({ length: Math.min(500, n - from) }, (_, k) =>
        fairAdd(q, "job", { workspaceId: ws, i: from + k }, {}, urgent),
      ),
    );
}

test("10k jobs from A do not block B; concurrency capped per tenant", async () => {
  const name = `fair-it-${randomUUID()}`;
  const q = new Queue<Data>(name, queueOptions());
  const [A, B] = [randomUUID(), randomUUID()];
  await fill(q, A, 10_000);
  await fill(q, B, 10);
  const running: Record<string, number> = { [A]: 0, [B]: 0 };
  const peak: Record<string, number> = { [A]: 0, [B]: 0 };
  const done: Record<string, number> = { [A]: 0, [B]: 0 };
  let aWhenBDone = -1;
  const started = Date.now();
  const worker = new Worker<Data>(
    name,
    fairProcessor(
      async (job: Job<Data>) => {
        const ws = job.data.workspaceId;
        peak[ws] = Math.max(peak[ws]!, ++running[ws]!);
        await sleep(5);
        running[ws]!--;
        if (++done[ws]! === 10 && ws === B) aWhenBDone = done[A]!;
      },
      async () => 3,
    ),
    { ...queueOptions(), concurrency: 8 },
  );
  try {
    while (aWhenBDone < 0) {
      assert.ok(Date.now() - started < 30_000, "B not finished within 30 s");
      await sleep(20);
    }
    // B finished well before A's 10,000 jobs (in FIFO: after). Margin for
    // B's jobs taken beyond its cap, put back on hold for 250 ms.
    assert.ok(aWhenBDone < 1000, `A avait fini ${aWhenBDone} jobs`);
    assert.ok(peak[A]! <= 3 && peak[B]! <= 3, JSON.stringify(peak));
  } finally {
    await worker.close(true);
    await q.obliterate({ force: true });
    await q.close();
  }
});

test("an urgent run (manual/test) jumps ahead of its tenant's backlog", async () => {
  const name = `fair-it-${randomUUID()}`;
  const q = new Queue<Data>(name, queueOptions());
  const A = randomUUID();
  await fill(q, A, 50);
  await fairAdd(q, "job", { workspaceId: A, i: -1 }, {}, true);
  const order: number[] = [];
  const worker = new Worker<Data>(
    name,
    fairProcessor(
      async (job: Job<Data>) => void order.push(job.data.i),
      async () => 1,
    ),
    { ...queueOptions(), concurrency: 1 },
  );
  try {
    while (order.length < 51) await sleep(20);
    assert.equal(order[0], -1);
  } finally {
    await worker.close(true);
    await q.obliterate({ force: true });
    await q.close();
  }
});
