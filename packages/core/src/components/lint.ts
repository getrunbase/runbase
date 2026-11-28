// Static checks of a page package (page.create / page.update): patterns that
// compile fine but break the page guide. Returned as warnings next to compile
// errors, never blocking. Heuristic and line-based on purpose: cheap, no AST.

export type LintRule =
  | "arbitrary-value"
  | "palette-class"
  | "hardcoded-options"
  | "client-grouping"
  | "any-sdk-result"
  | "missing-state"
  | "aggregate-total";

export type LintWarning = {
  file: string;
  line: number;
  rule: LintRule;
  text: string;
};

const ARBITRARY =
  /(?:^|[\s"'`{])(?:[a-z0-9-]+:)*-?[a-z][a-z0-9-]*-\[[^\]\s"'`]+\]/;
const PALETTE =
  /(?:^|[\s"'`:])(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|decoration|accent|caret|shadow|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|(?:^|[\s"'`:])(?:bg|text|border)-(?:white|black)\b/;
const OPTION_OBJECT = /\{\s*value:\s*["'`][^"'`]*["'`]\s*,\s*label:/g;
const SELECT_ITEM = /<SelectItem\s+value=["'][^"']+["']/g;
const LIMIT = /\blimit:\s*(\d+)/;
const CLIENT_GROUP = /\.reduce\(|Object\.groupBy\(|\bnew Map\(/;
const ANY = /(?::\s*any\b|\bas any\b|<any>|any\[\])/g;
const DATA_FALLBACK = /\.data\s*\?\?\s*[a-zA-Z_$]/;
const LIST_HOOK = /\b(useQuery|useInfiniteQuery|useAggregate)\s*[<(]/;
const SDK_HOOK =
  /\b(useQuery|useInfiniteQuery|useAggregate|useRecord|useTimeline)\s*[<(]/;
const EMPTY =
  /\.length\s*(?:===?\s*0|<\s*1|>\s*0|\?|&&|\|\|)|!\s*[\w$.?]+\.length|\bempty\b|Empty/i;

const AGGREGATE = /\baggregate\s*:|\buseAggregate\s*[<(]/;
const TOTAL = /\btotal\b/;

const HIGH_LIMIT = 200;
const MAX_ANY = 3;

const lineOf = (src: string, index: number) =>
  src.slice(0, index).split("\n").length;

function lintFile(file: string, src: string): LintWarning[] {
  const out: LintWarning[] = [];
  const add = (line: number, rule: LintRule, text: string) =>
    out.push({ file, line, rule, text });
  const lines = src.split("\n");

  lines.forEach((l, i) => {
    const a = ARBITRARY.exec(l);
    // Grid templates have no scale equivalent (sidebar layouts): allowed.
    if (a && !/grid-(?:cols|rows)-\[/.test(a[0]))
      add(
        i + 1,
        "arbitrary-value",
        `Arbitrary Tailwind value "${a[0].trim().replace(/^["'`{]/, "")}": use the 4/8 px scale and standard classes.`,
      );
    const p = PALETTE.exec(l);
    if (p)
      add(
        i + 1,
        "palette-class",
        `Palette class "${p[0].trim().replace(/^["'`:]/, "")}": use semantic tokens (bg-muted, text-muted-foreground, primary, destructive, chart-1..5).`,
      );
  });

  const usesObject = /\buseObject\s*\(/.test(src);
  if (!usesObject) {
    const opts = [...src.matchAll(OPTION_OBJECT), ...src.matchAll(SELECT_ITEM)];
    if (opts.length >= 2)
      add(
        lineOf(src, Math.min(...opts.map((m) => m.index))),
        "hardcoded-options",
        "Select options are hard-coded: read field keys and options with useObject(objectId).",
      );
  }

  const limit = LIMIT.exec(src);
  if (
    limit &&
    Number(limit[1]) >= HIGH_LIMIT &&
    /\buseQuery\s*[<(]/.test(src) &&
    CLIENT_GROUP.test(src) &&
    !/\baggregate\b|\buseAggregate\b/.test(src)
  )
    add(
      lineOf(src, limit.index),
      "client-grouping",
      `useQuery with limit ${limit[1]} then client-side grouping: use useQuery/useAggregate with groupBy and aggregate instead.`,
    );

  // With groupBy/aggregate, `total` counts groups, not records.
  const total = TOTAL.exec(src);
  if (total && AGGREGATE.test(src))
    add(
      lineOf(src, total.index),
      "aggregate-total",
      '`total` with aggregate counts groups, not records: read the record count from a count aggregate (aggregate: [{op: "count", as: "count"}]).',
    );

  const anys = [...src.matchAll(ANY)];
  if (anys.length >= MAX_ANY)
    add(
      lineOf(src, anys[0]!.index),
      "any-sdk-result",
      `${anys.length} \`any\` types: type SDK results, e.g. useQuery<Deal>() returns Row<Deal> with fields under row.data.`,
    );
  const fb = DATA_FALLBACK.exec(src);
  if (fb)
    add(
      lineOf(src, fb.index),
      "any-sdk-result",
      "`.data ?? …` fallback: SDK rows always have the shape {id, objectId, data}; read fields from row.data.",
    );

  const hook = SDK_HOOK.exec(src);
  if (hook) {
    const missing: string[] = [];
    if (!/\bloading\b|\bisLoading\b|Skeleton/.test(src))
      missing.push("loading");
    if (!/\berror\b/.test(src)) missing.push("error");
    if (LIST_HOOK.test(src) && !EMPTY.test(src)) missing.push("empty");
    if (missing.length)
      add(
        lineOf(src, hook.index),
        "missing-state",
        `${hook[1]} without ${missing.join(", ")} state: render a skeleton while loading, a message when empty and the error when it fails.`,
      );
  }
  return out;
}

export function lintPackage(files: Record<string, string>): LintWarning[] {
  return Object.entries(files)
    .filter(([f]) => /\.(tsx?|jsx?)$/.test(f))
    .flatMap(([f, src]) => lintFile(f, src));
}

export const formatLintWarning = (w: LintWarning) =>
  `${w.file}:${w.line} [${w.rule}] ${w.text}`;
