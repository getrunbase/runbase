import assert from "node:assert/strict";
import { test, after } from "node:test";
import { Queue } from "bullmq";
import { busConnection, busQueue, queuePrefix } from ".";
import { cleanupQueues } from "./cleanup";
import { runsQueue } from "../runs";
import { scheduleQueue } from "../triggers/schema";

after(() => setImmediate(() => process.exit(0)));

test("test queues have a dedicated prefix, distinct from the dev/prod worker", () => {
  assert.match(queuePrefix(), /^runbase-test-\d+$/);
  for (const q of [busQueue(), runsQueue(), scheduleQueue()])
    assert.equal(q.opts.prefix, queuePrefix());
});

test("without QUEUE_PREFIX: default BullMQ prefix", () => {
  const saved = process.env.QUEUE_PREFIX;
  delete process.env.QUEUE_PREFIX;
  try {
    assert.equal(queuePrefix(), "bull");
  } finally {
    process.env.QUEUE_PREFIX = saved;
  }
});

test("cleanupQueues only purges the prefix keys", async () => {
  const prefix = `${queuePrefix()}-cleanup`;
  const q = new Queue("probe", { connection: busConnection(), prefix });
  await q.add("x", {});
  await q.close();
  const redis = busConnection();
  await redis.set(`${prefix}x:keep`, "1");
  assert.ok((await redis.keys(`${prefix}:*`)).length > 0);
  await cleanupQueues(prefix);
  assert.deepEqual(await redis.keys(`${prefix}:*`), []);
  assert.equal(await redis.get(`${prefix}x:keep`), "1");
  await redis.del(`${prefix}x:keep`);
  redis.disconnect();
});
