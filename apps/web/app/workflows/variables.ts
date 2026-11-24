// Editor variables: storage stays the `{{…}}` template,
// the editor shows it as readable pills ("Contact › Company › Name").
// Pure: template <-> segments translation, labels, variable scope.
import type { Field } from "@runbase/core/objects/fields";
import { normalizeGraph } from "@runbase/core/workflows/graph";
import {
  fieldAt,
  type BlockInfo,
  type Definition,
  type ObjectInfo,
} from "./graph";
import { makeLabels, type WorkflowsT } from "./labels";
import { slugify } from "@runbase/core/slug";

export type Segment = { text: string } | { path: string };

const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g;
export const isTemplate = (v: unknown) =>
  typeof v === "string" && /\{\{[^{}]+\}\}/.test(v);

// Template -> segments texte / variable (texte vide omis).
export function parseTemplate(s: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of s.matchAll(TEMPLATE)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ path: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

export const toTemplate = (segs: Segment[]) =>
  segs.map((s) => ("path" in s ? `{{${s.path}}}` : s.text)).join("");

export const TRIGGER_RECORD = "{{record.id}}";

// Step output: key, label and object if it is a record.
export type StepOutput = { key: string; label: string; object?: string };
export type StepVars = { id: string; label: string; outputs: StepOutput[] };
// Pill labels, translated (see varWords).
export type VarWords = {
  current: (name?: string) => string;
  source: string;
  step: (label: string) => string;
  output: (key: string) => string;
};
export const varWords = (t: WorkflowsT): VarWords => ({
  current: (name) =>
    name ? t("vars.current", { name }) : t("vars.currentRecord"),
  source: t("vars.source"),
  step: (label) => t("vars.step", { label }),
  output: makeLabels(t).output,
});

export type VarScope = {
  words: VarWords;
  objects: ObjectInfo[];
  // Workflow object (triggering record).
  root?: string;
  // Previous steps on the same path.
  steps: StepVars[];
  // record.map: object of the source record (`{{source.x}}`).
  source?: string;
  // Record lists produced upstream (search, filter, relations).
  lists?: ListVar[];
};

export type ListVar = { path: string; label: string; object: string };

const isRef = (f?: Field) => f?.type === "ref" || f?.type === "refs";

// Splits a path: root (triggering record, source, step output),
// object of that root and the rest of the path.
function split(path: string, scope: VarScope) {
  const segs = path.split(".");
  if (segs[0] === "record")
    return { kind: "record" as const, object: scope.root, rest: segs.slice(1) };
  if (segs[0] === "source")
    return {
      kind: "source" as const,
      object: scope.source,
      rest: segs.slice(1),
    };
  if (segs[0] === "steps" && segs[2] === "output") {
    const step = scope.steps.find((s) => s.id === segs[1]);
    const out = step?.outputs.find((o) => o.key === segs[3]);
    return {
      kind: "step" as const,
      step,
      out,
      key: segs[3],
      object: out?.object,
      rest: segs.slice(4),
    };
  }
  return undefined;
}

// Field designated by a variable (type, icon); undefined otherwise.
export function varField(path: string, scope: VarScope) {
  const p = split(path, scope);
  if (!p?.object || !p.rest.length || p.rest.join(".") === "id")
    return undefined;
  return fieldAt(scope.objects, p.object, p.rest.join("."))?.field;
}

// Object of the record designated by a variable (`record.id`, relation, record
// of a step): used to generate the "Update a record" form.
export function varObject(path: string, scope: VarScope) {
  const p = split(path, scope);
  if (!p?.object) return undefined;
  const rest = p.rest.join(".");
  if (!rest || rest === "id") return p.object;
  const f = fieldAt(scope.objects, p.object, rest.replace(/\.id$/, ""))?.field;
  return isRef(f) ? (f as { object: string }).object : undefined;
}

// Display name of the record that triggers the workflow: "Current contact".
// ponytail: naive singular (drops the final "s"), enough for common names.
export function rootName(scope: Pick<VarScope, "objects" | "root" | "words">) {
  const name = scope.objects.find((o) => o.slug === scope.root)?.name;
  return scope.words.current(name?.replace(/s$/i, ""));
}

// Pill label, without braces.
export function varLabel(path: string, scope: VarScope): string {
  const p = split(path, scope);
  if (!p) return path;
  const rest = p.rest.join(".");
  const fields =
    rest && rest !== "id" && p.object
      ? fieldAt(scope.objects, p.object, rest.replace(/\.id$/, ""))?.labels
      : undefined;
  const tail = fields ? fields : rest && rest !== "id" ? [rest] : [];
  if (p.kind === "record")
    return tail.length ? tail.join(" › ") : rootName(scope);
  if (p.kind === "source") return [scope.words.source, ...tail].join(" › ");
  return [
    scope.words.step(p.step?.label ?? path.split(".")[1] ?? path),
    p.out?.label ?? scope.words.output(p.key ?? ""),
    ...tail,
  ].join(" › ");
}

// Readable label of a stored value (text and variables mixed).
export const templateLabel = (v: string, scope: VarScope) =>
  parseTemplate(v)
    .map((s) => ("path" in s ? varLabel(s.path, scope) : s.text))
    .join("");

// Steps upstream of `id` (every path leading to it).
export function ancestors(def: Definition, id: string): string[] {
  const { next } = normalizeGraph(def);
  const parents: Record<string, string[]> = {};
  for (const [src, out] of Object.entries(next))
    for (const t of Object.values(out).flat()) (parents[t] ??= []).push(src);
  const seen = new Set<string>();
  const todo = [...(parents[id] ?? [])];
  while (todo.length) {
    const s = todo.pop()!;
    if (seen.has(s) || s === id) continue;
    seen.add(s);
    todo.push(...(parents[s] ?? []));
  }
  return def.steps.map((s) => s.id).filter((s) => seen.has(s));
}

type JsonSchema = { properties?: Record<string, unknown> };

// Variable scope of a step: workflow object and typed outputs
// of the previous steps on the same path.
export function scopeFor(
  def: Definition,
  blocks: BlockInfo[],
  objects: ObjectInfo[],
  root: string | undefined,
  stepId: string | undefined,
  words: VarWords,
): VarScope {
  const scope: VarScope = { words, objects, root, steps: [], lists: [] };
  for (const id of stepId ? ancestors(def, stepId) : []) {
    const s = def.steps.find((x) => x.id === id)!;
    const block = blocks.find((b) => b.type === s.type);
    const input = (s.input ?? {}) as Record<string, unknown>;
    const recordObject =
      s.type === "record.create" || s.type === "record.map"
        ? (input.object as string | undefined)
        : s.type === "record.update"
          ? varObject(String(input.recordId ?? "").slice(2, -2), scope)
          : s.type === "record.get"
            ? varObject(String(input.id ?? "").slice(2, -2), scope)
            : undefined;
    const keys = Object.keys(
      (block?.outputSchema as JsonSchema | undefined)?.properties ?? {},
    );
    const label = block?.label ?? s.type;
    const list = (key: string, object: string | undefined, tail = "") =>
      object &&
      scope.lists!.push({
        path: `{{steps.${id}.output.${key}}}`,
        label: `${words.step(label)}${tail}`,
        object,
      });
    if (s.type === "record.search" || s.type === "list.filter")
      list(
        s.type === "record.search" ? "records" : "items",
        input.object as string | undefined,
      );
    if (s.type === "record.get" && recordObject)
      for (const rel of (input.include as string[] | undefined) ?? []) {
        const f = fieldAt(objects, recordObject, rel);
        if (isRef(f?.field))
          list(
            `record.included.${rel}`,
            (f!.field as { object: string }).object,
            ` › ${f!.labels.join(" › ")}`,
          );
      }
    scope.steps.push({
      id,
      label: block?.label ?? s.type,
      outputs: keys.map((key) => ({
        key,
        label: words.output(key),
        ...(key === "record" && recordObject && { object: recordObject }),
      })),
    });
  }
  return scope;
}

// Constant value entered for a record field, converted according to its type.
export function constantValue(f: Field, raw: string): unknown {
  if (raw === "") return undefined;
  if (isTemplate(raw)) return raw;
  if (f.type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (f.type === "bool") return raw === "true";
  if (f.type === "multi_select")
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return raw;
}

// Initial value of a field added with "+ Field".
export const fieldDefault = (f: Field): unknown =>
  f.type === "bool"
    ? false
    : f.type === "select"
      ? f.options[0]
      : f.type === "multi_select"
        ? []
        : "";

// Record values: sets or removes a field (undefined = removed).
export function setField(
  data: Record<string, unknown>,
  key: string,
  v: unknown,
): Record<string, unknown> {
  const next = { ...data, [key]: v };
  if (v === undefined) delete next[key];
  return next;
}

// record.map: `{ path } | { value }` mapping <-> record values, the source
// record being the `source` variable.
type Expr = { path: string } | { value: unknown };
export function mappingToData(m: Record<string, Expr>) {
  return Object.fromEntries(
    Object.entries(m).map(([k, e]) => [
      k,
      "path" in e ? `{{source.${e.path}}}` : e.value,
    ]),
  );
}
export function dataToMapping(d: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(d).map(([k, v]): [string, Expr] => {
      const m =
        typeof v === "string" && v.match(/^\{\{\s*source\.([^{}]+?)\s*\}\}$/);
      return [k, m ? { path: m[1]! } : { value: v }];
    }),
  );
}

// Switch: cases of a switch and generation of one case per select option.
export type SwitchCase = {
  id: string;
  label: string;
  op: string;
  value?: unknown;
};
const slug = (s: string) => slugify(s, { fallback: "cas" });

// Stable, unique id for a new case.
export function caseId(cases: SwitchCase[], label: string) {
  const base = `c_${slug(label)}`;
  let id = base;
  for (let i = 2; cases.some((c) => c.id === id); i++) id = `${base}_${i}`;
  return id;
}

// One `is` case per option missing from the existing cases.
export function casesFromOptions(
  options: string[],
  cases: SwitchCase[] = [],
): SwitchCase[] {
  const out = [...cases];
  for (const o of options)
    if (!out.some((c) => c.op === "eq" && c.value === o))
      out.push({ id: caseId(out, o), label: o, op: "eq", value: o });
  return out;
}
