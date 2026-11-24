// @getrunbase/kit: each block has a page example that compiles (page package
// importing @getrunbase/kit) and renders on the server with simulated data,
// without SDK calls outside the page permissions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePackage, denied, parseCall } from "@getrunbase/core/components";
import { seed } from "@getrunbase/core/components/example-data";
import { DASHBOARD_EXAMPLE, KIT_EXAMPLES } from "@getrunbase/kit/examples";
import render from "./harness";

const data = seed();
const BLOCKS = [
  "DataTable",
  "Kanban",
  "Calendar",
  "Timeline",
  "Gallery",
  "RecordForm",
  "RecordDetail",
  "KpiCard",
  "ChartCard",
  "FilterBar",
  "FileDrop",
  "CommandPalette",
];

test("one example per kit block", () => {
  assert.deepEqual(KIT_EXAMPLES.map((e) => e.block).sort(), [...BLOCKS].sort());
});

for (const ex of [...KIT_EXAMPLES, DASHBOARD_EXAMPLE])
  test(`kit ${ex.block}: the page package compiles and renders`, async () => {
    const r = await compilePackage({ "index.tsx": ex.source });
    assert.deepEqual(r.errors, []);
    // The kit comes from the vendor: never copied into the page bundle.
    assert.match(r.bundle!, /__vendor\["@getrunbase\/kit"\]/);
    assert.ok(r.bundle!.length < 5_000, `bundle ${r.bundle!.length} o`);
    const out = render({ bundle: r.bundle!, props: {}, data });
    assert.deepEqual(out.errors, []);
    assert.ok(out.html.includes(ex.expect), out.html.slice(0, 2_000));
    assert.doesNotMatch(out.html, /data-state="error"/);
    const perms = {
      write: [],
      workflows: [],
      files: false,
      ai: false,
      ...ex.permissions,
    };
    for (const c of out.sdkCalls)
      assert.equal(denied(perms, parseCall(c)), null, JSON.stringify(c));
  });
