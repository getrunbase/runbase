// uuid guard and mapping of Postgres 22xxx errors: unit test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../errors/app-error";
import { assertUuid, dataException, isUuid, mapDbError } from "./uuid";

test("isUuid: valid and invalid uuids", () => {
  assert.equal(isUuid("0e877df1-6f0a-4c3b-9d1e-2b5a8c7d9e10"), true);
  assert.equal(isUuid("0E877DF1-6F0A-4C3B-9D1E-2B5A8C7D9E10"), true);
  for (const v of [
    "0e877df1",
    "",
    " 0e877df1-6f0a-4c3b-9d1e-2b5a8c7d9e10",
    42,
    null,
    undefined,
    {},
  ])
    assert.equal(isUuid(v), false, String(v));
});

test("assertUuid: common.invalidId error without SQL", () => {
  assert.throws(
    () => assertUuid("0e877df1"),
    (e: unknown) =>
      e instanceof AppError &&
      e.code === "common.invalidId" &&
      e.kind === "invalid_input" &&
      e.message === "Invalid id: 0e877df1",
  );
});

test("mapDbError: 22P02 wrapped by Drizzle -> generic error", () => {
  const pg = Object.assign(
    new Error('invalid input syntax for type uuid: "0e877df1"'),
    { code: "22P02" },
  );
  const drizzle = new Error(
    "Failed query: select * from records where id = $1 and workspace_id = $2\nparams: 0e877df1,9b1d…",
    { cause: pg },
  );
  assert.equal(dataException(drizzle), "22P02");
  const out = mapDbError(drizzle) as AppError;
  assert.ok(out instanceof AppError);
  assert.equal(out.code, "common.invalidValue");
  assert.doesNotMatch(out.message, /Failed query|select|workspace_id|params/);
  assert.deepEqual(out.params, {});
  // Other error: unchanged.
  const other = Object.assign(new Error("dup"), { code: "23505" });
  assert.equal(mapDbError(other), other);
});
