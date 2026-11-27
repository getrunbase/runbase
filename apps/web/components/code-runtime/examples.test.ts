// page.examples examples: every multi-file package compiles, renders
// on the server with simulated data, without SDK calls outside permissions,
// and follows basic accessibility rules on the rendered HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compilePackage,
  denied,
  componentsGuide,
  EXAMPLES,
  parseCall,
} from "@getrunbase/core/components";
import render from "./harness";

test("three examples: crm, kanban, dashboard", () => {
  assert.deepEqual(
    EXAMPLES.map((e) => e.name),
    ["crm", "kanban", "dashboard"],
  );
});

test("guide and examples: no leftover of the old model or theme", () => {
  const text = componentsGuide(["button"]) + JSON.stringify(EXAMPLES);
  assert.doesNotMatch(text, /recipe|PageDefinition|dashboards\.save|theme/i);
});

for (const ex of EXAMPLES)
  test(`example ${ex.name}: compiles and simulated render without error`, async () => {
    assert.ok(Object.keys(ex.files).length > 1, "paquet multi-fichiers");
    const r = await compilePackage(ex.files, ex.entry);
    assert.deepEqual(r.errors, []);
    assert.match(r.bundle!, /__vendor\["@getrunbase\/kit"\]/);
    const out = render({ bundle: r.bundle!, props: {}, data: ex.data });
    assert.deepEqual(out.errors, []);
    const html = out.html;
    assert.ok(html.length > 500);
    assert.doesNotMatch(html, /data-state="error"/);
    // Minimal accessibility: one h1, no image without alt, no button
    // without an accessible name.
    assert.equal(html.match(/<h1\b/g)?.length, 1);
    assert.doesNotMatch(html, /<img(?![^>]*\balt=)[^>]*>/);
    for (const b of html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [])
      assert.ok(
        /aria-label="[^"]+"/.test(b) ||
          b.replace(/<[^>]+>/g, "").trim().length > 0,
        b,
      );
    for (const c of out.sdkCalls)
      assert.equal(
        denied(ex.permissions, parseCall(c)),
        null,
        JSON.stringify(c),
      );
  });
