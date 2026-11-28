// Render helpers: workspace scoping of storage keys, and reviewPage never
// throwing when the renderer is missing or slow.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  assertRendererUp,
  jobWorkspace,
  rendererHealth,
  reviewPage,
  shotKey,
  type RenderJob,
} from "./index";

after(() => setImmediate(() => process.exit(0)));

test("jobWorkspace reads the workspace of both job kinds", () => {
  const page = { kind: "page", workspaceId: "w1" } as RenderJob;
  const comp = { kind: "component", ctx: { workspaceId: "w2" } } as RenderJob;
  assert.equal(jobWorkspace(page), "w1");
  assert.equal(jobWorkspace(comp), "w2");
});

test("shotKey stays under the workspace renders prefix", () => {
  assert.equal(
    shotKey("w1", "j9", { viewport: "mobile", theme: "light" }),
    "w1/renders/j9/mobile-light.png",
  );
});

test("reviewPage turns a missing renderer into warnings, never an error", async () => {
  const review = await reviewPage(
    {
      kind: "page",
      workspaceId: crypto.randomUUID(),
      url: "http://127.0.0.1:9/p",
      token: "t",
      theme: "light",
    },
    50,
  );
  assert.deepEqual(review.shots, []);
  assert.equal(review.warnings.length, 2);
  assert.match(review.warnings.join("\n"), /desktop capture/);
  assert.match(review.warnings.join("\n"), /mobile capture/);
});

test("rendererHealth reports listening workers", async () => {
  const h = await rendererHealth({ getWorkers: async () => [{}, {}] });
  assert.deepEqual(h, { available: true, workers: 2 });
});

test("rendererHealth flags a queue without workers", async () => {
  const h = await rendererHealth({ getWorkers: async () => [] });
  assert.equal(h.available, false);
  assert.match(h.reason ?? "", /no renderer worker/);
});

test("rendererHealth is bounded when the queue backend hangs", async () => {
  const h = await rendererHealth(
    { getWorkers: () => new Promise(() => {}) },
    20,
  );
  assert.equal(h.available, false);
  assert.match(h.reason ?? "", /did not answer/);
});

test("assertRendererUp fails fast with platform.rendererUnavailable", async () => {
  await assert.rejects(
    assertRendererUp({ getWorkers: async () => [] }),
    (e: Error & { code?: string }) => {
      assert.equal(e.code, "platform.rendererUnavailable");
      assert.match(e.message, /retry will not help/);
      return true;
    },
  );
  await assertRendererUp({ getWorkers: async () => [{}] });
});
