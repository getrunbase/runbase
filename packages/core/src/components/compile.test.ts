// Compilation of code components (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileComponent, MAX_SOURCE } from "./compile";

test("compiles a TSX: allowed imports read from __vendor", async () => {
  const r = await compileComponent(
    `import { Button } from "@ui/button";
     import { useQuery } from "@runbase/sdk";
     export default function C() { const q = useQuery({ object: "o" }); return <Button>{q.data.length}</Button>; }`,
  );
  assert.deepEqual(r.errors, []);
  assert.match(r.bundle!, /__vendor\["@ui\/button"\]/);
  assert.match(r.bundle!, /__vendor\["react\/jsx-runtime"\]/);
});

test("refuses imports outside the list, with their position", async () => {
  for (const spec of [
    "fs",
    "./x",
    "https://evil.io/x.js",
    "react-dom/client",
    "@ui/../../x",
  ]) {
    const r = await compileComponent(
      `import x from ${JSON.stringify(spec)}; export default () => x;`,
    );
    assert.equal(r.bundle, undefined, spec);
    assert.match(r.errors[0]!.text, /forbidden import/, spec);
    assert.equal(r.errors[0]!.line, 1);
  }
});

test("syntax errors, missing export, size limits", async () => {
  const syntax = await compileComponent("export default () => <div>");
  assert.ok(syntax.errors[0]!.line);
  const noDefault = await compileComponent("const C = () => null;");
  assert.match(noDefault.errors[0]!.text, /export default/);
  const big = await compileComponent("x".repeat(MAX_SOURCE + 1));
  assert.match(big.errors[0]!.text, /source too large/);
});

const SOURCES: Record<string, string> = {
  avatar: `export const Avatar = () => <span>A</span>;`,
  a: `import "@components/b"; export const a = 1;`,
  b: `import "@components/a"; export const b = 1;`,
};
const resolve = async (name: string, version?: number) =>
  SOURCES[name] ? { source: SOURCES[name], version: version ?? 4 } : null;

test("@components: compiled into the bundle, version pinned in deps", async () => {
  const r = await compileComponent(
    `import { Avatar } from "@components/avatar";
     export default function C() { return <Avatar />; }`,
    { resolve },
  );
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.bundle && r.deps, [{ name: "avatar", version: 4 }]);
  assert.equal(r.bundle && r.sources.length, 2);
  const pinned = await compileComponent(
    `import { Avatar } from "@components/avatar@2"; export default () => <Avatar />;`,
    { resolve },
  );
  assert.deepEqual(pinned.bundle && pinned.deps, [
    { name: "avatar", version: 2 },
  ]);
});

test("@components: cycle and unknown component refused", async () => {
  const cyc = await compileComponent(
    `import "@components/a"; export default () => null;`,
    { resolve },
  );
  assert.match(cyc.errors[0]!.text, /circular import: a -> b -> a/);
  const unk = await compileComponent(
    `import "@components/nope"; export default () => null;`,
    { resolve },
  );
  assert.match(unk.errors[0]!.text, /unknown component: @components\/nope/);
});

test("lucide-react bundled with tree-shaking, react stays vendor", async () => {
  const r = await compileComponent(
    `import { Mail, Check } from "lucide-react";
     export default () => <p><Mail /><Check /></p>;`,
  );
  assert.deepEqual(r.errors, []);
  assert.ok(r.bundle!.length < 20_000, `bundle ${r.bundle!.length} octets`);
  assert.match(r.bundle!, /__vendor\.react\b/);
});

test("lucide-react resolved outside the package folder (Next bundle)", async () => {
  const r = await compileComponent(
    `import { Mail } from "lucide-react"; export default () => <Mail />;`,
    { dirs: ["/nonexistent", process.cwd()] },
  );
  assert.deepEqual(r.errors, []);
});

// Multi-file packages.
import {
  compilePackage,
  MAX_PACKAGE_FILES,
  MAX_PACKAGE_SOURCE,
  originalPosition,
  packageCompileError,
} from "./compile";

const PKG = {
  "index.tsx": `import { Card } from "./components/Card";
import { money } from "./lib/format.ts";
export default function Page() { return <Card title={money(3)} />; }`,
  "components/Card.tsx": `import { Card as UiCard } from "@ui/card";
export const Card = ({ title }: { title: string }) => <UiCard>{title}</UiCard>;`,
  "lib/format.ts": `export const money = (n: number) => n.toFixed(2) + " EUR";`,
};

test("package: relative imports (with/without extension, folder index)", async () => {
  const r = await compilePackage(PKG);
  assert.deepEqual(r.errors, []);
  assert.match(r.bundle!, /EUR/);
  const idx = await compilePackage({
    "index.tsx": `import { x } from "./lib"; export default () => x;`,
    "lib/index.ts": `import { y } from "../util"; export const x = y;`,
    "util.ts": `export const y = 1;`,
  });
  assert.deepEqual(idx.errors, []);
});

test("package: cycle between files accepted", async () => {
  const r = await compilePackage({
    "index.tsx": `import { a } from "./a"; export default () => a();`,
    "a.ts": `import { b } from "./b"; export const a = () => b;`,
    "b.ts": `import { a } from "./a"; export const b = typeof a;`,
  });
  assert.deepEqual(r.errors, []);
});

test("package: missing file reported at file:line of the import", async () => {
  const r = await compilePackage({
    "index.tsx": `import { Card } from "./components/Card";\nexport default () => <Card />;`,
    "components/Card.tsx": `\nimport { x } from "../lib/missing";\nexport const Card = () => x;`,
  });
  assert.equal(r.bundle, undefined);
  assert.match(r.errors[0]!.text, /file not found: \.\.\/lib\/missing/);
  assert.equal(r.errors[0]!.file, "components/Card.tsx");
  assert.equal(r.errors[0]!.line, 2);
  const e = packageCompileError(r.errors);
  assert.equal(e.code, "pages.compileFailed");
  assert.match(e.message, /components\/Card\.tsx:2:/);
  // Escaping the package is forbidden.
  const out = await compilePackage({
    "index.tsx": `import x from "../../etc/passwd"; export default () => x;`,
  });
  assert.match(out.errors[0]!.text, /file not found/);
});

test("package: import outside the allow list refused", async () => {
  const r = await compilePackage({
    "index.tsx": `import "./a"; export default () => null;`,
    "a.ts": `import fs from "fs"; export const a = fs;`,
  });
  assert.match(r.errors[0]!.text, /forbidden import: fs/);
  assert.equal(r.errors[0]!.file, "a.ts");
});

test("package: per-package caps", async () => {
  const many = Object.fromEntries(
    Array.from({ length: MAX_PACKAGE_FILES + 1 }, (_, i) => [`f${i}.ts`, ""]),
  );
  assert.match((await compilePackage(many)).errors[0]!.text, /too many files/);
  const half = "x".repeat(MAX_PACKAGE_SOURCE / 2 + 1);
  const big = await compilePackage({ "index.tsx": half, "a.ts": half });
  assert.match(big.errors[0]!.text, /package too large/);
});

test("package: syntax and runtime errors mapped back to the original source", async () => {
  const syntax = await compilePackage({
    "index.tsx": `import "./b"; export default () => null;`,
    "b.tsx": `export const b = 1;\n\nconst c = <div>;`,
  });
  assert.equal(syntax.errors[0]!.file, "b.tsx");
  assert.equal(syntax.errors[0]!.line, 3);
  const r = await compilePackage({
    "index.tsx": `import { boom } from "./lib/boom";\nexport default function P() { return boom(); }`,
    "lib/boom.ts": `export function boom() {\n  const v = 1;\n  throw new Error("boom" + v);\n}`,
  });
  assert.deepEqual(r.errors, []);
  const col = r.bundle!.indexOf("throw");
  const lines = r.bundle!.slice(0, col).split("\n");
  const pos = originalPosition(r.map!, lines.length, lines.at(-1)!.length + 1);
  assert.deepEqual(pos && [pos.file, pos.line], ["lib/boom.ts", 3]);
});
