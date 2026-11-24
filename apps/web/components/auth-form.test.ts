import { test } from "node:test";
import assert from "node:assert/strict";
import { autoCompleteOf } from "./auth-form";

test("auth fields: autocomplete hints", () => {
  assert.equal(autoCompleteOf({ name: "email", type: "email" }), "email");
  assert.equal(
    autoCompleteOf({ name: "password", type: "password" }),
    "current-password",
  );
  assert.equal(
    autoCompleteOf({ name: "confirm", type: "password" }),
    "new-password",
  );
  assert.equal(
    autoCompleteOf({
      name: "password",
      type: "password",
      autoComplete: "new-password",
    }),
    "new-password",
  );
  assert.equal(autoCompleteOf({ name: "name", type: "text" }), "name");
});
