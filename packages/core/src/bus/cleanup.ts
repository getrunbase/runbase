import { busConnection } from ".";

// Deletes all BullMQ keys of a prefix (disposable test queues).
export async function cleanupQueues(prefix: string) {
  const redis = busConnection();
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${prefix}:*`,
        "COUNT",
        500,
      );
      cursor = next;
      if (keys.length) await redis.unlink(...keys);
    } while (cursor !== "0");
  } finally {
    redis.disconnect();
  }
}
