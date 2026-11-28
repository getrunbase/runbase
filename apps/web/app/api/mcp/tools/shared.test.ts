import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./shared";

// Drizzle-style wrapper: SQL text and params in the message, Postgres error in `cause`.
function drizzleError(code: string, extra: Record<string, string> = {}) {
  const cause = Object.assign(new Error("duplicate key value violates"), {
    code,
    ...extra,
  });
  return Object.assign(
    new Error(
      'Failed query: insert into "records" ("workspace_id") values ($1)\nparams: 0b8c-secret-ws',
    ),
    { cause },
  );
}

const text = async (e: unknown) => {
  const res = (await run(() => Promise.reject(e))) as {
    isError?: boolean;
    content: { text: string }[];
  };
  assert.equal(res.isError, true);
  return res.content[0]!.text;
};

test("run: raw DB errors are mapped, SQL and params never echoed", async () => {
  const unique = await text(
    drizzleError("23505", { constraint_name: "records_email_uq" }),
  );
  assert.match(unique, /^\[conflict\] Duplicate value/);
  assert.match(unique, /records_email_uq/);
  for (const t of [
    unique,
    await text(drizzleError("23502", { column_name: "name" })),
    await text(drizzleError("22P02")),
    await text(drizzleError("57014")),
    await text(drizzleError("XX000")),
  ]) {
    assert.doesNotMatch(t, /insert into|params|secret-ws|Failed query/);
  }
  assert.match(await text(drizzleError("22P02")), /^\[invalid_input\]/);
  assert.match(await text(drizzleError("XX000")), /Database error \(XX000\)/);
});

test("run: non-DB errors keep their message", async () => {
  assert.equal(await text(new Error("boom")), "[error] boom");
});
