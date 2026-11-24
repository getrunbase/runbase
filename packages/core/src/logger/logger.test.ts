import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { createLogger, withContext } from ".";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(String(chunk)));
      cb();
    },
  });
  return { lines, stream };
}

test("writes one JSON line with service, level and ISO time", () => {
  const { lines, stream } = capture();
  createLogger({ service: "web", level: "info" }, stream).info("hello");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.msg, "hello");
  assert.equal(lines[0]!.service, "web");
  assert.equal(lines[0]!.level, "info");
  assert.match(String(lines[0]!.time), /^\d{4}-\d{2}-\d{2}T/);
});

test("withContext carries workspaceId, runId, requestId and drops empty fields", () => {
  const { lines, stream } = capture();
  const base = createLogger({ level: "info" }, stream);
  withContext(
    { workspaceId: "ws1", runId: "run1", requestId: "req1", extra: undefined },
    base,
  ).warn({ step: 2 }, "slow");
  assert.equal(lines[0]!.workspaceId, "ws1");
  assert.equal(lines[0]!.runId, "run1");
  assert.equal(lines[0]!.requestId, "req1");
  assert.equal(lines[0]!.step, 2);
  assert.equal("extra" in lines[0]!, false);
});

test("redacts secrets and serializes errors", () => {
  const { lines, stream } = capture();
  createLogger({ level: "info" }, stream).error(
    {
      err: new Error("boom"),
      headers: { authorization: "Bearer x" },
      token: "t",
    },
    "failed",
  );
  const line = lines[0] as {
    err: { message: string; stack: string };
    headers: { authorization: string };
    token: string;
  };
  assert.equal(line.err.message, "boom");
  assert.ok(line.err.stack);
  assert.equal(line.headers.authorization, "[redacted]");
  assert.equal(line.token, "[redacted]");
});

test("respects the level threshold", () => {
  const { lines, stream } = capture();
  const log = createLogger({ level: "warn" }, stream);
  log.info("hidden");
  log.warn("shown");
  assert.deepEqual(
    lines.map((l) => l.msg),
    ["shown"],
  );
});
