import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonPaths, pickPath } from "./webhook";

test("jsonPaths: leaves, arrays at the first element", () => {
  const p = {
    uid: "b1",
    payload: { attendees: [{ email: "a@x.io" }], tags: [] },
  };
  assert.deepEqual(jsonPaths(p), ["uid", "payload.attendees.0.email"]);
  assert.equal(pickPath(p, "payload.attendees.0.email"), "a@x.io");
});
