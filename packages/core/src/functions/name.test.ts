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
