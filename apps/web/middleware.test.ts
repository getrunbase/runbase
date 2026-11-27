import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "http://localhost"), { headers });
const toLogin = (r: Response) =>
  r.status === 307 &&
  new URL(r.headers.get("location") ?? "", "http://localhost").pathname === "/login";

test("sign-in wall: /p/* with a screenshot token header goes through", async () => {
  assert.equal(toLogin(await middleware(req("/p/x", { "x-screenshot-token": "t" }))), false);
});

test("sign-in wall: /p/* without header nor cookie redirects to /login", async () => {
  assert.equal(toLogin(await middleware(req("/p/x"))), true);
});

test("sign-in wall: the header does not open other pages", async () => {
  assert.equal(
    toLogin(await middleware(req("/settings", { "x-screenshot-token": "t" }))),
    true,
  );
});
