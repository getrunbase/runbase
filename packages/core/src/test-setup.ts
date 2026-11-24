// Loaded by `pnpm test` (--import) in each test process.
// Isolates BullMQ queues from dev/prod workers (e.g. runbase-worker-1) that
// share the same Redis: without a dedicated prefix, they consume test jobs.
import { after } from "node:test";
import { cleanupQueues } from "./bus/cleanup";

process.env.QUEUE_PREFIX ??= `runbase-test-${process.pid}`;
const prefix = process.env.QUEUE_PREFIX;

// Child process of the runner (one per file): purges its queues at the end of
// the file. Registered before the file hooks, hence before their process.exit.
if (process.env.NODE_TEST_CONTEXT && prefix.startsWith("runbase-test-"))
  after(() => cleanupQueues(prefix));
