import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Boundary } from "./boundary";
import {
  describeError,
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
