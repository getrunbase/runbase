// Integration: the worker started with RUNBASE_EXTENSIONS loads the
// fixture, which receives the worker.started event. Isolated queues (dedicated
// prefix) and unreachable database: the worker touches no shared data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(
  new URL("../../../packages/core/src/extensions/fixtures/recording.mjs", import.meta.url),
);
const workerDir = fileURLToPath(new URL("..", import.meta.url));

test("worker: the configured extension receives worker.started", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "runbase-ext-")), "events.jsonl");
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: workerDir,
    env: {
      ...process.env,
      RUNBASE_EXTENSIONS: fixture,
      RUNBASE_EXTENSIONS_FIXTURE_OUT: out,
      QUEUE_PREFIX: `runbase-test-ext-${process.pid}`,
      DATABASE_URL: "postgres://nobody:nobody@127.0.0.1:1/runbase_ext_test",
      BOARD_PORT: String(20_000 + (process.pid % 20_000)),
      LOG_LEVEL: "silent",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  try {
    const deadline = Date.now() + 30_000;
    while (!(existsSync(out) && readFileSync(out, "utf8").includes("worker.started"))) {
      assert.ok(child.exitCode === null, `worker exited: ${stderr}`);
      assert.ok(Date.now() < deadline, `timeout: ${stderr}`);
      await new Promise((r) => setTimeout(r, 200));
    }
    const events = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(events[0], { event: "worker.started", props: {} });
  } finally {
    child.kill("SIGKILL");
  }
});
