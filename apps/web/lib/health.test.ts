import assert from "node:assert/strict";
import { test } from "node:test";
import { readiness } from "@getrunbase/core/health";
import { healthHandler, readyHandler } from "./health";

const ok = async () => {};
const ko = async () => {
  throw new Error("connection refused");
};

test("/api/health answers 200 without touching dependencies", async () => {
  const res = healthHandler()();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("/api/ready answers 200 when DB and Redis are up", async () => {
  const res = await readyHandler(() =>
    readiness({ database: ok, redis: ok }),
  )();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    status: "ok",
    checks: { database: "ok", redis: "ok" },
  });
});

test("/api/ready answers 503 when the DB is down", async () => {
  const res = await readyHandler(() =>
    readiness({ database: ko, redis: ok }),
  )();
  assert.equal(res.status, 503);
  assert.equal((await res.json()).checks.database, "down");
});

test("/api/ready answers 503 when Redis is down", async () => {
  const res = await readyHandler(() =>
    readiness({ database: ok, redis: ko }),
  )();
  assert.equal(res.status, 503);
  assert.equal((await res.json()).checks.redis, "down");
});
