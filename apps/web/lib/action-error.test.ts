import assert from "node:assert/strict";
import { test } from "node:test";
import { notFound, redirect } from "next/navigation";
import { appError, forbidden } from "@getrunbase/core/app-error";
import { runAction } from "./action-error";

test("runAction: value -> { data }", async () => {
  assert.deepEqual(await runAction(async () => 42), { data: 42 });
});

test("runAction: AppError -> { error } (serializable item)", async () => {
  const r = await runAction(async () => {
    throw forbidden("apiKeys.scopeRequired", "Scope {needed} required", {
      needed: "admin",
    });
  });
  assert.deepEqual(r, {
    error: {
      code: "apiKeys.scopeRequired",
      params: { needed: "admin" },
      message: "Scope admin required",
    },
  });
  const v = await runAction(async () => {
    throw appError("web.invalidInput", "Invalid input: {detail}", {
      detail: "x",
    });
  });
  assert.equal(v.error?.code, "web.invalidInput");
});

test("runAction: redirect and notFound are rethrown", async () => {
  await assert.rejects(
    runAction(async () => redirect("/login")),
    (e: { digest?: string }) => String(e.digest).startsWith("NEXT_REDIRECT"),
  );
  await assert.rejects(
    runAction(async () => notFound()),
    (e: { digest?: string }) => String(e.digest).includes("404"),
  );
});

test("runAction: an unexpected error is rethrown, not returned", async () => {
  await assert.rejects(
    runAction(async () => {
      throw new Error("connection to db://secret failed");
    }),
    /secret/,
  );
});
