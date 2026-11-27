import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Boundary } from "./boundary";
import {
  describeConsoleArgs,
  describeError,
  reportDeduper,
  stackSummary,
  withComponentStack,
} from "./describe-error";

test("describeError: an empty message still says what failed", () => {
  assert.equal(
    describeError(new Error(undefined)).message,
    "Error (no message)",
  );
  assert.equal(
    describeError(new TypeError("")).message,
    "TypeError (no message)",
  );
  assert.equal(describeError(new Error("boom")).message, "boom");
  assert.ok(describeError(new Error("boom")).stack?.includes("boom"));
  assert.equal(describeError(undefined).message, "Unknown error (no message)");
  assert.equal(describeError("oops").message, "oops");
  assert.equal(describeError({ code: 1 }).message, '{"code":1}');
});

test("stackSummary: page frames first, failing component", () => {
  const stack = withComponentStack(
    [
      "Error: boom",
      "    at useTranslations (vendor.js:1:2)",
      "    at Kpi (runbase-page.js:12:5)",
      "    at Page (runbase-page.js:40:3)",
    ].join("\n"),
    "\n    at Kpi (runbase-page.js:12:5)\n    at Boundary (runtime.js:1:1)",
  );
  assert.deepEqual(stackSummary(stack), {
    frames: ["at Kpi (runbase-page.js:12:5)", "at Page (runbase-page.js:40:3)"],
    component: "Kpi",
  });
  assert.deepEqual(stackSummary(undefined), { frames: [] });
  assert.equal(withComponentStack("s", "  "), "s");
});

test("Boundary: an error with an empty message stops rendering, reported once", async () => {
  const win = new Window({ url: "http://localhost/c" });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const reports: { message: string; stack?: string }[] = [];
  let renders = 0;
  const Bad = () => {
    renders++;
    throw new Error(undefined);
  };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el, { onCaughtError: () => {} });
  await act(async () => {
    root.render(
      createElement(
        Boundary,
        { onError: (e) => reports.push(e) },
        createElement(Bad),
      ),
    );
  });
  const before = renders;
  // A props refresh (the runtime redraws on new props) must not retry.
  await act(async () => {
    root.render(
      createElement(
        Boundary,
        { onError: (e) => reports.push(e) },
        createElement(Bad),
      ),
    );
  });
  assert.equal(renders, before);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.message, "Error (no message)");
  assert.match(reports[0]!.stack ?? "", /Component stack:[\s\S]*Bad/);
  assert.equal(el.innerHTML, "");
  root.unmount();
});

// console.error report first (as React logs it), then the boundary report,
// through the frame dedup into a store keyed by message (page.errors).
async function storedFor(make: () => Error) {
  const win = new Window({ url: "http://localhost/c" });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const fresh = reportDeduper();
  const store = new Map<string, string | undefined>();
  const send = (e: { message: string; stack?: string }) => {
    if (fresh(e.message, e.stack)) store.set(e.message, e.stack);
  };
  const Bad = () => {
    throw make();
  };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el, {
    onCaughtError: (err) => send(describeConsoleArgs([err])),
  });
  await act(async () => {
    root.render(createElement(Boundary, { onError: send }, createElement(Bad)));
  });
  root.unmount();
  return [...store];
}

test("empty Error: exactly one stored entry, no blank message", async () => {
  const entries = await storedFor(() => new Error());
  assert.equal(entries.length, 1);
  assert.equal(entries[0]![0], "Error (no message)");
});

test("normal error: stored entry keeps the component stack", async () => {
  const entries = await storedFor(() => new Error("kaboom"));
  assert.equal(entries.length, 1);
  assert.equal(entries[0]![0], "kaboom");
  assert.match(entries[0]![1] ?? "", /Component stack:[\s\S]*Bad/);
});

test("reportDeduper: richer stack passes once, poorer one never replaces it", () => {
  const fresh = reportDeduper();
  const rich = withComponentStack("Error: x", "at Bad (a.js:1:1)");
  assert.equal(fresh("x", "Error: x"), true);
  assert.equal(fresh("x", "Error: x"), false);
  assert.equal(fresh("x", rich), true);
  assert.equal(fresh("x", rich), false);
  assert.equal(fresh("x", "Error: x"), false);
});
