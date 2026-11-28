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
  return <div className="p-4 bg-muted text-muted-foreground">{q.data.map((r) => r.data.name)}</div>;
}`;
  assert.deepEqual(rules({ "index.tsx": good }), []);
});

test("kit-only pages and non-code files are ignored", () => {
  assert.deepEqual(
    rules({
      "index.tsx": `import { DataTable } from "@getrunbase/kit";
export default () => <DataTable object="o" />;`,
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

test("the page.examples packages pass the static checks", () => {
  for (const e of EXAMPLES) assert.deepEqual(lintPackage(e.files), [], e.name);
});
