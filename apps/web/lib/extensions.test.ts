// Integration: web startup (Next instrumentation, Node
// runtime) loads the RUNBASE_EXTENSIONS module, which receives web.started.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { getExtensions, resetExtensions } from "@getrunbase/core/extensions";

const fixture = fileURLToPath(
  new URL("../../../packages/core/src/extensions/fixtures/recording.mjs", import.meta.url),
);

after(() => resetExtensions());

test("web: the configured extension receives web.started", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "runbase-ext-")), "events.jsonl");
  Object.assign(process.env, {
    NEXT_RUNTIME: "nodejs",
    RUNBASE_EXTENSIONS: fixture,
    RUNBASE_EXTENSIONS_FIXTURE_OUT: out,
    OTEL_METRICS_EXPORTER: "none",
  });
  process.env.BETTER_AUTH_SECRET ||= "test-secret-test-secret-test-secret";
  process.env.DATABASE_URL ||= "postgres://nobody@127.0.0.1:1/x";
  const { register } = await import("../instrumentation");
  await register();
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8").trim()), {
    event: "web.started",
    props: {},
  });
  assert.equal((await getExtensions().client.headScripts())[0]?.id, "fixture");
});
