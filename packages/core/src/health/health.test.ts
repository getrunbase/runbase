import assert from "node:assert/strict";
import { test } from "node:test";
import { readiness, redisCheck } from ".";

const ok = async () => {};
const ko = async () => {
  throw new Error("down");
};

test("ok when every dependency answers", async () => {
  assert.deepEqual(await readiness({ database: ok, redis: ok }), {
    status: "ok",
    checks: { database: "ok", redis: "ok" },
  });
});

test("down when the database fails", async () => {
  const r = await readiness({ database: ko, redis: ok });
  assert.equal(r.status, "down");
  assert.deepEqual(r.checks, { database: "down", redis: "ok" });
});

test("down when redis fails", async () => {
  const r = await readiness({ database: ok, redis: ko });
  assert.equal(r.status, "down");
  assert.equal(r.checks.redis, "down");
});

test("a hanging check times out as down", async () => {
  const started = Date.now();
  const r = await readiness(
    { database: () => new Promise(() => {}), redis: ok },
    50,
  );
  assert.equal(r.checks.database, "down");
  assert.ok(Date.now() - started < 1000);
});

test("real redis check reports an unreachable server as down quickly", async () => {
  const started = Date.now();
  const r = await readiness({ redis: redisCheck("redis://127.0.0.1:1") }, 1500);
  assert.equal(r.checks.redis, "down");
  assert.ok(Date.now() - started < 2000);
});
