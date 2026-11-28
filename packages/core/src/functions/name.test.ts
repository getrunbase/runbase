// Function names in strict kebab-case: no DB or Deno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { functionInputSchema } from "./index";

const ok = (name: string) =>
  functionInputSchema.safeParse({ name, code: "x" }).success;

test("function names are strict kebab-case", () => {
  assert.equal(ok("score-lead"), true);
  assert.equal(ok("score_lead"), false);
  assert.equal(ok("score.lead"), false);
  assert.equal(ok("-score"), false);
});

test("missingOutputKeys lists required keys never returned", async () => {
  const { missingOutputKeys } = await import("./index");
  const schema = {
    type: "object",
    properties: { a: {}, b: {}, c: {} },
    required: ["a", "b"],
  };
  assert.deepEqual(missingOutputKeys(schema, { a: 1 }), ["b"]);
  // Optional (not required) keys may be omitted.
  assert.deepEqual(
    missingOutputKeys({ properties: { a: {}, b: {} } }, { a: 1 }),
    [],
  );
  assert.deepEqual(missingOutputKeys(schema, { a: 1, b: null }), []);
  assert.deepEqual(missingOutputKeys({}, { a: 1 }), []);
  assert.deepEqual(missingOutputKeys(schema, [1]), []);
});
