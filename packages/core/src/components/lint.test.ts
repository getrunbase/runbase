// Static checks of page packages (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES } from "./examples";
import { formatLintWarning, lintPackage } from "./lint";

const rules = (files: Record<string, string>) =>
  lintPackage(files).map((w) => w.rule);

const bad = `import { useQuery } from "@getrunbase/sdk";
const STAGES = [
  { value: "lead", label: "Lead" },
  { value: "won", label: "Won" },
];
export default function Page() {
  const q = useQuery({ object: "o", limit: 1000 });
  const rows: any[] = q.data as any;
  const byStage = rows.reduce((m: any, r) => m, {});
  const name = rows[0].data ?? rows[0];
  return <div className="max-h-[90vh] p-[13px] bg-blue-500">{STAGES.length}</div>;
}`;

test("a page with the anti-patterns gets every warning", () => {
  const w = lintPackage({ "index.tsx": bad });
  const got = new Set(w.map((x) => x.rule));
  for (const r of [
    "arbitrary-value",
    "palette-class",
    "hardcoded-options",
    "client-grouping",
    "any-sdk-result",
    "missing-state",
  ])
    assert.ok(got.has(r as never), `missing ${r}`);
  const arb = w.find((x) => x.rule === "arbitrary-value")!;
  assert.equal(arb.line, 11);
  assert.match(
    formatLintWarning(arb),
    /^index\.tsx:11 \[arbitrary-value\] .*max-h-\[90vh\]/,
  );
  assert.match(
    w.find((x) => x.rule === "missing-state")!.text,
    /loading, error, empty/,
  );
});

test("a clean page gets no warning", () => {
  const good = `import { useAggregate, useObject, useQuery } from "@getrunbase/sdk";
type Deal = { name: string };
export default function Page() {
  const obj = useObject("o");
  const q = useQuery<Deal>({ object: "o", limit: 50 });
  const agg = useAggregate({ object: "o", groupBy: "stage", aggregate: [{ op: "count", as: "n" }] });
  if (q.loading) return <Skeleton />;
  if (q.error) return <p className="text-destructive">{q.error}</p>;
  if (!q.data.length) return <p className="text-muted-foreground">No deals</p>;
  return <main className="mx-auto max-w-7xl p-4 md:p-6 bg-muted text-muted-foreground">{q.data.map((r) => r.data.name)}</main>;
}`;
  assert.deepEqual(rules({ "index.tsx": good }), []);
});

test("kit-only pages and non-code files are ignored", () => {
  assert.deepEqual(
    rules({
      "index.tsx": `import { DataTable } from "@getrunbase/kit";
export default () => (
  <main className="mx-auto max-w-7xl p-4 md:p-6"><DataTable object="o" /></main>
);`,
      "notes.md": "bg-red-500 p-[3px]",
    }),
    [],
  );
});

test("hard-coded options are fine when the schema is read", () => {
  assert.deepEqual(
    rules({
      "a.tsx": `const o = useObject(id);
<SelectItem value="a" /> <SelectItem value="b" />`,
    }),
    [],
  );
  assert.deepEqual(
    rules({ "a.tsx": `<SelectItem value="a" /> <SelectItem value="b" />` }),
    ["hardcoded-options"],
  );
});

test("`total` next to an aggregate is flagged: it counts groups", () => {
  const src = `const q = useQuery({ object: "o", groupBy: "stage", aggregate: [{ op: "sum", field: "amount", as: "amount" }] });
const n = q.total;`;
  const w = lintPackage({ "a.tsx": src }).filter(
    (x) => x.rule === "aggregate-total",
  );
  assert.equal(w.length, 1);
  assert.equal(w[0]!.line, 2);
  assert.deepEqual(
    rules({ "a.tsx": `const q = useQuery({ object: "o" }); q.total;` }).filter(
      (r) => r === "aggregate-total",
    ),
    [],
  );
});

test("page layout: h1 classes, main landmark, width, padding", () => {
  assert.deepEqual(
    rules({
      "index.tsx": `export default () => (
  <div className="p-2">
    <h1 className="text-2xl font-bold">Deals</h1>
  </div>
);`,
    }),
    ["page-heading", "page-landmark"],
  );
  assert.deepEqual(
    rules({
      "index.tsx": `export default () => <main className="flex flex-col gap-6 p-8"><h1 className="text-xl font-semibold tracking-tight">A</h1></main>;`,
    }),
    ["page-width", "page-padding"],
  );
  // The landmark may live in another file of the package.
  assert.deepEqual(
    rules({
      "index.tsx": `import { Shell } from "./shell";
export default () => <Shell />;`,
      "shell.tsx": `export const Shell = () => <main className="mx-auto max-w-7xl p-4 md:p-6" />;`,
    }),
    [],
  );
});

test("unused @getrunbase/kit imports warn", () => {
  const w = lintPackage({
    "index.tsx": `import { DataTable, KpiCard, type Row as R } from "@getrunbase/kit";
export default () => <main className="mx-auto max-w-7xl p-4 md:p-6"><DataTable object="o" /></main>;`,
  });
  assert.deepEqual(
    w.map((x) => [x.rule, x.text.split('"')[1]]),
    [
      ["unused-import", "KpiCard"],
      ["unused-import", "R"],
    ],
  );
});

test("the page.examples packages pass the static checks", () => {
  for (const e of EXAMPLES) assert.deepEqual(lintPackage(e.files), [], e.name);
});
