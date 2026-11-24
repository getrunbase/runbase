// /p/[slug] rendering: the block mounts the runtime sandbox iframe
// then, on the iframe `ready`, sends it the compiled bundle; a
// message from another origin is ignored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { CodeFrame } from "./code-frame";

const win = new Window({ url: "http://localhost:7100/p/demo" });
Object.assign(globalThis, {
  window: win,
  document: win.document,
  location: win.location,
  history: win.history,
  MutationObserver: win.MutationObserver,
  HTMLElement: win.HTMLElement,
  Node: win.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});

test("CodeFrame: sandbox iframe mounted with the compiled bundle", async () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={{}} onError={() => {}}>
        <CodeFrame
          id="demo"
          props={{}}
          host={{
            bundle: async () => ({ bundle: "COMPILED_BUNDLE", css: "" }),
            call: async () => null,
          }}
        />
      </NextIntlClientProvider>,
    );
  });

  const iframe = el.querySelector("iframe")!;
  assert.ok(iframe, "iframe montée");
  assert.equal(iframe.getAttribute("src"), "/c/runtime");
  assert.equal(iframe.getAttribute("sandbox"), "allow-scripts");

  const sent: Record<string, unknown>[] = [];
  // happy-dom does not load iframes: fake window that captures the
  // messages sent by the parent.
  const cw = { postMessage: (m: Record<string, unknown>) => sent.push(m) };
  Object.defineProperty(iframe, "contentWindow", { value: cw });
  const ready = (origin: string) =>
    act(async () => {
      window.dispatchEvent(
        new win.MessageEvent("message", {
          data: { type: "ready" },
          origin,
          source: cw as never,
        }) as unknown as Event,
      );
    });

  await ready("https://evil.example");
  assert.equal(sent.length, 0, "origine inattendue ignorée");
  await ready("null");
  const init = sent.find((m) => m.type === "init");
  assert.equal(init?.bundle, "COMPILED_BUNDLE");

  await act(async () => root.unmount());
});
