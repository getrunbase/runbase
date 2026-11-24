// Readable zod errors for functions: no DB or Deno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../errors/app-error";
import { validateSchema } from "./sandbox";

const schema = {
  type: "object",
  properties: { leadId: { type: "string" }, n: { type: "number" } },
  required: ["leadId"],
};

const fail = (v: unknown, kind: "input" | "output" = "input") => {
  try {
    validateSchema(schema, v, kind);
  } catch (e) {
    assert.ok(e instanceof AppError);
    return e;
  }
  throw new Error("expected a failure");
};

test("invalid input: readable path and message, no JSON dump", () => {
  const e = fail({});
  assert.equal(e.code, "functions.invalidInput");
  assert.equal(
    e.message,
    "Invalid input leadId: expected string, received undefined",
  );
  assert.deepEqual(e.params, {
    path: "leadId",
    message: "expected string, received undefined",
  });
  assert.ok(!e.message.includes("["));
});

test("several fields, root, output", () => {
  const e = fail({ n: "x" });
  assert.equal(e.params.path, "leadId, n");
  assert.match(String(e.params.message), /expected string.*; expected number/);
  assert.equal(fail("x").params.path, "(root)");
  assert.equal(fail({}, "output").code, "functions.invalidOutput");
});

test("valid or without schema: value returned", () => {
  assert.deepEqual(validateSchema(schema, { leadId: "a" }, "input"), {
    leadId: "a",
  });
  assert.equal(validateSchema({}, 5, "input"), 5);
  assert.equal(validateSchema(undefined, 5, "input"), 5);
});
