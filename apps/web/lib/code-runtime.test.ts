// page.test runtime: the harness and a trivial TSX build for the browser
// (no database, no renderer).
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { compileComponent, compilePackage } from "@getrunbase/core/components";
import { browserOnly, testHarness } from "./code-runtime";

test("page.test harness builds for the browser", async () => {
  const js = await testHarness();
  assert.ok(js.length > 1000);
  assert.doesNotMatch(js, /bullmq/);
});

test("page.test compiles a trivial TSX (source and files)", async () => {
  const one = await compileComponent(
    "export default function C() { return <p>hi</p>; }",
  );
  assert.deepEqual(one.errors, []);
  const pkg = await compilePackage({
    "index.tsx": "export default function Page() { return <p>hi</p>; }",
  });
  assert.deepEqual(pkg.errors, []);
});

test("browser builds drop server modules and keep node:* external", async () => {
  const r = await build({
    stdin: {
      contents: `import { createHash } from "node:crypto";
import { render } from "@getrunbase/core/render";
import { mockCall } from "@getrunbase/core/components/mock";
export const x = [createHash, render, mockCall];`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    logLevel: "silent",
    plugins: [browserOnly],
  });
  const js = r.outputFiles[0]!.text;
  assert.doesNotMatch(js, /bullmq/);
  assert.match(js, /node:crypto/);
  assert.match(js, /mockCall|filter/);
});
