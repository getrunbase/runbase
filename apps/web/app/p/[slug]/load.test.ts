// /p/[slug] page: only a missing page gives a 404; a database
// error is logged and rethrown.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { notFound as notFoundError } from "@runbase/core/errors";
import { pageOr404 } from "./load";

const is404 = (e: unknown) =>
  String((e as { digest?: string }).digest).endsWith(";404");

test("missing page: 404", async () => {
  await assert.rejects(pageOr404(Promise.resolve(null)), is404);
  await assert.rejects(
    pageOr404(Promise.reject(notFoundError("pages.notFound", "Page not found"))),
    is404,
  );
});

test("database error: logged and rethrown, no 404", async () => {
  const log = mock.method(console, "error", () => {});
  const db = new Error("connection terminated");
  await assert.rejects(pageOr404(Promise.reject(db)), (e) => e === db);
  assert.equal(log.mock.callCount(), 1);
  log.mock.restore();
});

test("page found: rendered as is", async () => {
  assert.deepEqual(await pageOr404(Promise.resolve({ id: "p" })), { id: "p" });
});
