// Workflow editor: pure manipulations of the definition.
import type { Field } from "@getrunbase/core/objects";
import { normalizeGraph, targetsOf } from "@getrunbase/core/workflows/graph";

export type Step = {
  id: string;
  type: string;
  input?: Record<string, unknown>;
};
export type Definition = {
  trigger: Record<string, unknown>;
  steps: Step[];
  // Targets of each branch; several run in parallel.
  next?: Record<string, Record<string, string[]>>;
  // Steps started by the trigger; absent = the first one.
  entry?: string[];
  // Positions of nodes moved by hand, ignored by the engine.
  layout?: Record<string, { x: number; y: number }>;
};
export type BlockInfo = {
  type: string;
  label: string;
  description: string;
  branches: readonly string[];
  // Branches computed from the input (Switch: one case = one branch).
  dynamicBranches?: boolean;
  inputSchema: unknown;
  outputSchema?: unknown;
};

type Case = { id: string; label?: string; value?: unknown };
const casesOf = (step: Step) =>
  Array.isArray(step.input?.cases) ? (step.input.cases as Case[]) : [];

// Branches of a step: those of the block, one per Switch case
// (+ Else), or declared (ai.decide).
export function branchesOf(step: Step, block?: BlockInfo): string[] {
  if (block?.dynamicBranches || step.type === "switch")
    return [...casesOf(step).map((c) => c.id), "else"];
  if (block?.branches.length) return [...block.branches];
  const b = step.input?.branches;
  return Array.isArray(b) ? b.map(String) : [];
}

// Branch label: the Switch case one, otherwise the FR table.
export function branchName(
  step: Step | undefined,
  branch: string,
  fallback: (b: string) => string,
) {
  const c = step && casesOf(step).find((x) => x.id === branch);
  return c ? c.label || String(c.value ?? branch) : fallback(branch);
}

// Steps with no incoming link (trigger included).
export function unlinked(def: Definition): string[] {
  const { entry, next } = normalizeGraph(def);
  const linked = new Set([
    ...entry,
    ...Object.values(next).flatMap((o) => Object.values(o).flat()),
  ]);
  return def.steps.map((s) => s.id).filter((id) => !linked.has(id));
}

// Positions: those saved in the definition, otherwise automatic.
export const positions = (def: Definition) => ({
  ...layout(def),
  ...def.layout,
});

export function moveNode(
  def: Definition,
  id: string,
  pos: { x: number; y: number },
): Definition {
  return {
    ...def,
    layout: {
      ...def.layout,
      [id]: { x: Math.round(pos.x), y: Math.round(pos.y) },
    },
  };
}

export const entryOf = (def: Definition) => normalizeGraph(def).entry;
export const targetsAt = (def: Definition, source: string, branch: string) =>
  targetsOf(def.next?.[source]?.[branch]);

// Layered layout: BFS depth from the entries; steps of the
// same layer (parallel paths) side by side, centred under the trigger.
export function layout(def: Definition) {
  const { entry, next } = normalizeGraph(def);
  const depth: Record<string, number> = {};
  const todo = [...entry];
  for (const id of entry) depth[id] = 0;
  while (todo.length) {
    const id = todo.shift()!;
    for (const t of Object.values(next[id] ?? {}).flat())
      if (depth[t] === undefined) {
        depth[t] = depth[id]! + 1;
        todo.push(t);
      }
  }
  const rows: Record<number, string[]> = {};
  for (const s of def.steps) {
    const d = depth[s.id] ?? Math.max(-1, ...Object.values(depth)) + 1;
    depth[s.id] = d;
    (rows[d] ??= []).push(s.id);
  }
  const pos: Record<string, { x: number; y: number }> = {
    trigger: { x: 0, y: 0 },
  };
  for (const [d, ids] of Object.entries(rows))
    ids.forEach((id, col) => {
      // ponytail: fixed spacing > max node height (~170px), otherwise links are hidden.
      pos[id] = {
        x: (col - (ids.length - 1) / 2) * 300,
        y: (Number(d) + 1) * 240,
      };
    });
  return pos;
}

export function uniqueId(def: Definition, type: string) {
  const base = type.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  let i = 1;
  while (def.steps.some((s) => s.id === `${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function addStep(def: Definition, type: string): Definition {
  return {
    ...def,
    steps: [...def.steps, { id: uniqueId(def, type), type, input: {} }],
  };
}

export function setTargets(
  def: Definition,
  source: string,
  branch: string,
  targets: string[],
): Definition {
  const out = { ...def.next?.[source] };
  if (targets.length) out[branch] = targets;
  else delete out[branch];
  const next = { ...def.next, [source]: out };
  if (!Object.keys(out).length) delete next[source];
  return { ...def, next };
}

export function removeStep(def: Definition, id: string): Definition {
  const next = Object.fromEntries(
    Object.entries(def.next ?? {})
      .filter(([k]) => k !== id)
      .map(([k, out]) => [
        k,
        Object.fromEntries(
          Object.entries(out)
            .map(([b, t]) => [b, targetsOf(t).filter((x) => x !== id)] as const)
            .filter(([, t]) => t.length),
        ),
      ]),
  );
  const steps = def.steps.filter((s) => s.id !== id);
  const { [id]: _moved, ...rest } = def.layout ?? {};
  void _moved;
  return {
    ...def,
    steps,
    next,
    ...(def.layout && { layout: rest }),
    ...(def.entry && { entry: def.entry.filter((x) => x !== id) }),
  };
}

// Adds a target to the branch (one more link, without replacing).
export function connect(
  def: Definition,
  source: string,
  branch: string,
  target: string,
): Definition {
  const cur = targetsAt(def, source, branch);
  if (cur.includes(target)) return def;
  return setTargets(def, source, branch, [...cur, target]);
}

// Removes a target from the branch (all of them if `target` is absent).
export function disconnect(
  def: Definition,
  source: string,
  branch: string,
  target?: string,
): Definition {
  const cur = targetsAt(def, source, branch);
  return setTargets(
    def,
    source,
    branch,
    target === undefined ? [] : cur.filter((t) => t !== target),
  );
}

// Trigger -> step link: adds or removes the step from the entries.
export function addEntry(def: Definition, id: string): Definition {
  const entry = entryOf(def);
  return entry.includes(id) ? def : { ...def, entry: [...entry, id] };
}

export function removeEntry(def: Definition, id: string): Definition {
  return { ...def, entry: entryOf(def).filter((x) => x !== id) };
}

export function setInput(
  def: Definition,
  id: string,
  input: Record<string, unknown>,
): Definition {
  return {
    ...def,
    steps: def.steps.map((s) => (s.id === id ? { ...s, input } : s)),
  };
}

// Config form fields derived from the block's JSON Schema.
export type FormField = {
  key: string;
  kind: "text" | "number" | "bool" | "enum" | "list" | "json";
  required: boolean;
  options?: string[];
};
type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
};

export function formFields(schema: unknown): FormField[] {
  const s = schema as JsonSchema;
  return Object.entries(s?.properties ?? {}).map(([key, p]) => {
    const required = s.required?.includes(key) ?? false;
    const t = p.type ?? p.anyOf?.find((a) => a.type)?.type;
    const type = Array.isArray(t) ? t[0] : t;
    if (p.enum)
      return { key, kind: "enum", required, options: p.enum.map(String) };
    if (type === "string") return { key, kind: "text", required };
    if (type === "number" || type === "integer")
      return { key, kind: "number", required };
    if (type === "boolean") return { key, kind: "bool", required };
    if (type === "array" && p.items?.type === "string")
      return { key, kind: "list", required };
    return { key, kind: "json", required };
  });
}

// Condition builder: entered value converted according to the field type and operator.
type FieldType = { type: string };
export function parseValue(f: FieldType, op: string, raw: string): unknown {
  if (op === "is_empty" || op === "is_not_empty") return undefined;
  const one = (v: string): unknown =>
    f.type === "number" ? Number(v) : f.type === "bool" ? v === "true" : v;
  if (op === "older_than" || op === "within") return Number(raw);
  if (op === "between") return raw.split(",").map((v) => Number(v.trim()));
  if (op === "in")
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map(one);
  return one(raw);
}

export const showValue = (v: unknown) =>
  v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v);

// Workspace object and its database (database → object → field selectors).
export type ObjectInfo = {
  slug: string;
  name: string;
  database: { slug: string; name: string };
  fields: Field[];
};

// Field at the end of an `a.b.c` path from `root`, following the
// ref / refs relations; `labels` gives the label of each segment.
export function fieldAt(objects: ObjectInfo[], root: string, path: string) {
  let cur = objects.find((o) => o.slug === root);
  const labels: string[] = [];
  const segs = path.split(".");
  for (const [i, seg] of segs.entries()) {
    const f = cur?.fields.find((x) => x.key === seg);
    if (!f) return undefined;
    labels.push(f.label);
    if (i === segs.length - 1) return { field: f, labels };
    if (f.type !== "ref" && f.type !== "refs") return undefined;
    cur = objects.find((o) => o.slug === f.object);
  }
  return undefined;
}
