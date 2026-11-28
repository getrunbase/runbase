// Retry policy classification and error cleanup: no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { appError } from "../errors/app-error";
import { cleanStack, formatIssues, stripServerPaths } from "../errors/clean";
import { isNonRetryable, NonRetryable } from "./retryable";

test("config and auth errors are not retried", () => {
  assert.ok(isNonRetryable(new NonRetryable("x")));
  for (const code of [
    "blocks.unknownSecret",
    "blocks.domainNotAllowed",
    "connections.missing",
    "connections.notFound",
  ])
    assert.ok(isNonRetryable(appError(code, "x")), code);
  assert.ok(isNonRetryable(appError("blocks.mcpHttp", "x", { status: 404 })));
  assert.ok(
    isNonRetryable(appError("a.b", "x", {}, { kind: "unauthorized" })),
  );
  assert.ok(!isNonRetryable(appError("blocks.mcpHttp", "x", { status: 429 })));
  assert.ok(!isNonRetryable(appError("blocks.mcpHttp", "x", { status: 408 })));
  assert.ok(!isNonRetryable(appError("blocks.mcpHttp", "x", { status: 503 })));
  assert.ok(!isNonRetryable(new Error("network down")));
});

test("validation errors (match, required, schema) are not retried", () => {
  for (const code of [
    "records.fieldRequired",
    "blocks.matchOrExternalIdRequired",
    "pages.editNoMatch",
    "catalog.slugMismatch",
    "functions.invalidInput",
    "blocks.mapInvalidValue",
    "function.emptyOutputSchema",
  ])
    assert.ok(isNonRetryable(appError(code, "x")), code);
  assert.ok(isNonRetryable(z.object({ a: z.string() }).safeParse({}).error));
  assert.ok(!isNonRetryable(appError("blocks.mcpTimeout", "x")));
});

test("zod issues become `field: message` lines", () => {
  const r = z.object({ email: z.string(), n: z.number() }).safeParse({});
  assert.equal(
    formatIssues(r.error!.message),
    "email: expected string, received undefined\nn: expected number, received undefined",
  );
  assert.equal(formatIssues("[not json"), "[not json");
  assert.equal(formatIssues("plain"), "plain");
});

test("server absolute paths stripped from stacks", () => {
  const stack =
    "Error: boom\n    at run (/home/app/runbase/packages/core/src/runs/engine.ts:12:3)\n    at file:///srv/x/node_modules/bullmq/dist/worker.js:5:1\n    at /opt/other/thing.js:1:2";
  assert.equal(
    stripServerPaths(stack),
    "Error: boom\n    at run (packages/core/src/runs/engine.ts:12:3)\n    at node_modules/bullmq/dist/worker.js:5:1\n    at thing.js:1:2",
  );
  assert.doesNotMatch(cleanStack(stack), /\/home|\/srv|\/opt/);
});
