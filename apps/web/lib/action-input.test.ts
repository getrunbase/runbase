import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { AppError } from "@runbase/core/app-error";
import { formInput, list, parseInput } from "./action-input";

test("parseInput returns the parsed value", () => {
  assert.deepEqual(parseInput(z.object({ a: z.number() }), { a: 1 }), {
    a: 1,
  });
});

test("parseInput throws a translatable web.invalidInput error", () => {
  assert.throws(
    () => parseInput(z.object({ a: z.number() }), { a: "x" }),
    (e: unknown) =>
      e instanceof AppError &&
      e.code === "web.invalidInput" &&
      /Invalid input/.test(e.message),
  );
});

test("formInput: single values as strings, repeated keys as arrays", () => {
  const f = new FormData();
  f.append("name", "a");
  f.append("scopes", "read");
  f.append("scopes", "write");
  assert.deepEqual(formInput(f), { name: "a", scopes: ["read", "write"] });
});

test("list: missing, single and repeated values", () => {
  assert.deepEqual(list.parse(undefined), []);
  assert.deepEqual(list.parse(""), []);
  assert.deepEqual(list.parse("a"), ["a"]);
  assert.deepEqual(list.parse(["a", "b"]), ["a", "b"]);
});
