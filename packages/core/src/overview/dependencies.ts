// Dependency map of a workspace, computed without agent input: which
// functions, workflows and pages read or write each object field, and for
// each workflow its trigger, steps, objects touched and external domains.
// Static analysis only (workflow definitions, function code, page sources):
// a dynamic key built at runtime is not seen.
//
// References are strings: `workflow:<name>#<step>` (`#trigger` for the
// trigger), `function:<name>`, `page:<name>`.

export type DepObject = {
  id: string;
  slug: string;
  fields: { key: string }[];
};
export type DepWorkflow = {
  id: string;
  name: string;
  status?: string;
  definition: unknown;
};
export type DepFunction = {
  name: string;
  code: string;
  permissions?: { domains?: string[]; records?: string } | null;
};
export type DepPage = {
  id: string;
  name: string;
  files: Record<string, string>;
  permissions?: { objects?: string[]; write?: string[] } | null;
};

// Fields read and written, per object slug. `*` = the whole record
// (deletion, read by id).
export type Touches = Record<string, { reads: string[]; writes: string[] }>;

export type FieldDeps = { writers: string[]; readers: string[] };

export type DependencyMap = {
  fields: Record<string, FieldDeps>;
  workflows: {
    id: string;
    name: string;
    status?: string;
    trigger: unknown;
    steps: { id: string; type: string }[];
    objects: Touches;
    functions: string[];
    domains: string[];
  }[];
  functions: {
    name: string;
    objects: Touches;
    domains: string[];
    // Set when the code writes records but no object could be resolved
    // (record id passed at runtime and no calling workflow names one).
    unknown?: string;
  }[];
  pages: { id: string; name: string; objects: Touches }[];
};

type Step = { id: string; type: string; input?: unknown };
type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isStep = (v: unknown): v is Step =>
  isRec(v) && typeof v.id === "string" && typeof v.type === "string";
const uniq = (a: string[]) => [...new Set(a)].sort();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Collects every step, nested ones included (loop `do`, branches...).
function collectSteps(v: unknown, out: Step[] = []): Step[] {
  if (Array.isArray(v)) for (const x of v) collectSteps(x, out);
  else if (isRec(v)) {
    if (isStep(v)) out.push(v);
    for (const x of Object.values(isStep(v) ? { input: v.input } : v))
      collectSteps(x, out);
  }
  return out;
}

// Every string inside a value.
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (isRec(v)) for (const x of Object.values(v)) strings(x, out);
  return out;
}

// `field` keys used in a filter DSL (recursive).
function filterFields(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) filterFields(x, out);
  else if (isRec(v)) {
    if (typeof v.field === "string") out.push(v.field);
    for (const x of Object.values(v)) filterFields(x, out);
  }
  return out;
}

const URL_RE = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;
function domainsIn(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((m) => m[1]!.toLowerCase());
}

export function buildDependencyMap(input: {
  objects: DepObject[];
  workflows: DepWorkflow[];
  functions: DepFunction[];
  pages: DepPage[];
}): DependencyMap {
  const bySlug = new Map<string, DepObject>();
  for (const o of input.objects) {
    bySlug.set(o.slug, o);
    bySlug.set(o.id, o);
  }
  // Slug or uuid, `$object:slug` (template placeholder) accepted.
  const resolve = (ref: unknown) =>
    typeof ref === "string"
      ? bySlug.get(ref.replace(/^\$object:/, ""))
      : undefined;
  const fields: Record<string, FieldDeps> = {};
  const note = (
    t: Touches,
    who: string,
    obj: DepObject,
    keys: string[],
    kind: "reads" | "writes",
  ) => {
    const entry = (t[obj.slug] ??= { reads: [], writes: [] });
    const known = new Set(obj.fields.map((f) => f.key));
    for (const k of keys) {
      if (k !== "*" && !known.has(k)) continue;
      entry[kind] = uniq([...entry[kind], k]);
      if (k === "*") continue;
      const f = (fields[`${obj.slug}.${k}`] ??= { writers: [], readers: [] });
      const list = kind === "writes" ? "writers" : "readers";
      f[list] = uniq([...f[list], who]);
    }
  };
  // Object whose fields include every given key, when exactly one does.
  const guess = (keys: string[]) => {
    const hits = input.objects.filter(
      (o) =>
        keys.length > 0 && keys.every((k) => o.fields.some((f) => f.key === k)),
    );
    return hits.length === 1 ? hits[0] : undefined;
  };

  // Fields of `obj` that function code reads or writes (`key:` = write when
  // the function may write, `.key` / `["key"]` = read).
  const scanFn = (
    objects: Touches,
    who: string,
    obj: DepObject,
    code: string,
    canWrite: boolean,
    fallback: "reads" | "writes" = "reads",
  ) => {
    const reads: string[] = [];
    const writes: string[] = [];
    for (const { key } of obj.fields) {
      const k = escape(key);
      const asKey = new RegExp(`(^|[{,\\s])["']?${k}["']?\\s*:`, "m");
      const asRead = new RegExp(`\\.${k}\\b|\\[["']${k}["']\\]`);
      if (canWrite && asKey.test(code)) writes.push(key);
      else if (asKey.test(code) || asRead.test(code)) reads.push(key);
      if (canWrite && asRead.test(code)) reads.push(key);
    }
    note(objects, who, obj, reads, "reads");
    note(objects, who, obj, writes, "writes");
    if (!reads.length && !writes.length)
      note(objects, who, obj, ["*"], fallback);
  };

  const functions = input.functions.map((fn) => {
    const objects: Touches = {};
    const who = `function:${fn.name}`;
    const code = fn.code ?? "";
    const canWrite =
      fn.permissions?.records === "write" &&
      /records\.(upsert|update|transact|delete|merge)\s*\(/.test(code);
    for (const obj of input.objects) {
      const named = [obj.slug, obj.id].some((n) =>
        new RegExp(`["'\`]${escape(n)}["'\`]`).test(code),
      );
      if (named) scanFn(objects, who, obj, code, canWrite);
    }
    const domains = uniq([
      ...(fn.permissions?.domains ?? []),
      ...domainsIn(code),
    ]);
    return {
      name: fn.name,
      objects,
      domains,
      canWrite,
    } as DependencyMap["functions"][number] & { canWrite?: boolean };
  });
  const fnByName = new Map(functions.map((f) => [f.name, f]));
  // Objects a workflow hands to each function (step `object`, else the
  // trigger object): resolves writes made with a runtime record id.
  const fnTargets = new Map<string, Set<DepObject>>();

  const workflows = input.workflows.map((wf) => {
    const def = (isRec(wf.definition) ? wf.definition : {}) as {
      trigger?: Rec;
      steps?: unknown;
    };
    const trigger = def.trigger ?? null;
    const objects: Touches = {};
    const domains: string[] = [];
    const fns: string[] = [];
    const subject = resolve(trigger?.object);
    const tWho = `workflow:${wf.name}#trigger`;
    if (subject && trigger) {
      const reads = [
        ...(Array.isArray(trigger.fields) ? (trigger.fields as string[]) : []),
        ...filterFields(trigger.filter),
        ...(typeof trigger.match === "string" ? [trigger.match] : []),
      ];
      note(objects, tWho, subject, reads.length ? reads : ["*"], "reads");
      if (isRec(trigger.mapping))
        note(objects, tWho, subject, Object.keys(trigger.mapping), "writes");
    }
    const steps = collectSteps(def.steps);
    for (const s of steps) {
      const who = `workflow:${wf.name}#${s.id}`;
      const inp = isRec(s.input) ? s.input : {};
      const all = strings(inp);
      // `{{record.x}}`: field x of the run's record (trigger object).
      if (subject) {
        const keys = all.flatMap((t) =>
          [...t.matchAll(/\{\{\s*record\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]!),
        );
        if (keys.length) note(objects, who, subject, keys, "reads");
      }
      for (const t of all) domains.push(...domainsIn(t));
      if (s.type.startsWith("fn.")) {
        const name = s.type.slice(3);
        fns.push(name);
        const t = resolve(inp.object) ?? subject;
        if (t) {
          const set = fnTargets.get(name) ?? new Set<DepObject>();
          fnTargets.set(name, set.add(t));
        }
        domains.push(...(fnByName.get(name)?.domains ?? []));
        continue;
      }
      // `{{record.id}}` as a whole value: the step targets the run's record.
      const isRunId = (v: unknown) =>
        typeof v === "string" && /^\{\{\s*record\.id\s*\}\}$/.test(v.trim());
      if (s.type === "record.transact") {
        const ops = Array.isArray(inp.ops) ? inp.ops.filter(isRec) : [];
        for (const op of ops) {
          const keys = isRec(op.data) ? Object.keys(op.data) : [];
          const t =
            resolve(op.object) ??
            (isRunId(op.id) ? subject : undefined) ??
            (op.op === "update" ? guess(keys) : undefined);
          if (!t) continue;
          if (op.op === "delete") {
            note(objects, who, t, ["*"], "writes");
            continue;
          }
          note(objects, who, t, keys, "writes");
          if (typeof op.match === "string")
            note(objects, who, t, [op.match], "reads");
        }
        continue;
      }
      if (s.type === "record.merge") {
        // Writes the `keep` record and deletes the `merge` records.
        const t =
          resolve(inp.object) ?? (isRunId(inp.keep) ? subject : undefined);
        if (t) note(objects, who, t, ["*"], "writes");
        continue;
      }
      const data = isRec(inp.data)
        ? Object.keys(inp.data)
        : isRec(inp.mapping)
          ? Object.keys(inp.mapping)
          : [];
      const onRunRecord = all.some((t) => /\{\{\s*record\.id\s*\}\}/.test(t));
      const target =
        resolve(inp.object) ??
        (onRunRecord && /^record\.(update|get|delete)$/.test(s.type)
          ? subject
          : undefined) ??
        (s.type === "record.update" ? guess(data) : undefined);
      if (!target) continue;
      if (/^record\.(create|update|upsert|map)$/.test(s.type)) {
        note(objects, who, target, data, "writes");
        const key = [inp.match, inp.key].filter(
          (k): k is string => typeof k === "string",
        );
        if (key.length) note(objects, who, target, key, "reads");
      } else if (s.type === "record.delete") {
        note(objects, who, target, ["*"], "writes");
      } else if (/^record\./.test(s.type)) {
        const f = filterFields(inp.filter);
        note(objects, who, target, f.length ? f : ["*"], "reads");
      }
    }
    return {
      id: wf.id,
      name: wf.name,
      status: wf.status,
      trigger,
      steps: steps.map((s) => ({ id: s.id, type: s.type })),
      objects,
      functions: uniq(fns),
      domains: uniq(domains),
    };
  });

  // Writing functions that name no object: use the calling workflows.
  const codeByName = new Map(input.functions.map((f) => [f.name, f.code]));
  for (const fn of functions as (DependencyMap["functions"][number] & {
    canWrite?: boolean;
  })[]) {
    const canWrite = fn.canWrite;
    delete fn.canWrite;
    if (!canWrite) continue;
    const writes = Object.values(fn.objects).some((o) => o.writes.length);
    if (writes) continue;
    const targets = fnTargets.get(fn.name);
    if (!targets?.size) {
      fn.unknown = "objects: unknown (dynamic record id)";
      continue;
    }
    const code = codeByName.get(fn.name) ?? "";
    for (const obj of targets)
      scanFn(fn.objects, `function:${fn.name}`, obj, code, true, "writes");
  }

  const pages = input.pages.map((p) => {
    const objects: Touches = {};
    const who = `page:${p.name}`;
    const src = Object.values(p.files ?? {}).join("\n");
    const readable = [
      ...(p.permissions?.objects ?? []),
      ...(p.permissions?.write ?? []),
    ];
    const writable = new Set(
      (p.permissions?.write ?? []).map((r) => resolve(r)?.slug),
    );
    for (const ref of uniq(readable)) {
      const obj = resolve(ref);
      if (!obj) continue;
      const used = obj.fields
        .map((f) => f.key)
        .filter((k) =>
          new RegExp(`["'\`]${escape(k)}["'\`]|\\.${escape(k)}\\b`).test(src),
        );
      note(objects, who, obj, used.length ? used : ["*"], "reads");
      if (writable.has(obj.slug))
        note(objects, who, obj, used.length ? used : ["*"], "writes");
    }
    return { id: p.id, name: p.name, objects };
  });

  return { fields, workflows, functions, pages };
}

// One entity of the map: `object.field`, `object` (slug), `workflow:<name>`,
// `function:<name>` or `page:<name>`. Null when nothing matches.
export function dependenciesOf(map: DependencyMap, entity: string) {
  const [kind, ...rest] = entity.split(":");
  const name = rest.join(":");
  if (kind === "workflow" && name)
    return map.workflows.find((w) => w.name === name || w.id === name) ?? null;
  if (kind === "function" && name)
    return map.functions.find((f) => f.name === name) ?? null;
  if (kind === "page" && name)
    return map.pages.find((p) => p.name === name || p.id === name) ?? null;
  if (entity in map.fields) return { field: entity, ...map.fields[entity] };
  const prefix = `${entity}.`;
  const fields = Object.fromEntries(
    Object.entries(map.fields).filter(([k]) => k.startsWith(prefix)),
  );
  const using = (kind: string, list: { name: string; objects: Touches }[]) =>
    list.filter((e) => entity in e.objects).map((e) => `${kind}:${e.name}`);
  const users = [
    ...using("workflow", map.workflows),
    ...using("function", map.functions),
    ...using("page", map.pages),
  ];
  if (!Object.keys(fields).length && !users.length) return null;
  return { object: entity, fields, usedBy: uniq(users) };
}
