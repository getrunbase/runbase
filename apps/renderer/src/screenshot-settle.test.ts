// Render wait for page captures: code blocks and skeletons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { codeErrors, pageSettled } from "./screenshot";

test("capture: waits for code blocks and skeletons, reads errors", () => {
  const doc = new Window().document as unknown as Document;
  doc.body.innerHTML = `<div data-code-block="a" data-code-state="loading"></div>`;
  assert.equal(pageSettled(doc), false);
  doc.body.innerHTML = `<div data-code-block="a" data-code-state="ready"></div><div data-slot="skeleton"></div>`;
  assert.equal(pageSettled(doc), false);
  doc.body.innerHTML = `<div data-code-block="a" data-code-state="error" data-code-error="boom"></div>`;
  assert.equal(pageSettled(doc), true);
  assert.deepEqual(codeErrors(doc), ["composant a : boom"]);
});
