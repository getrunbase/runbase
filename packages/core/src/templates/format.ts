// Versioned `runbase-template.json` format: validator only, no
// template in the core. No database dependency (importable anywhere).
//
// Workspace-specific identifiers never appear: an object,
// workflow or record uuid is replaced by a local reference
// (`$object:<slug>`, `$workflow:<key>`, `$record:<key>`), resolved at import.
// Secrets only appear by their NAME (`secrets`), never their value.
import { z } from "zod";
import { appError, errorItem } from "../errors/app-error";
import { fieldsSchema } from "../objects/fields";
import { definitionSchema } from "../workflows";
import { functionInputSchema } from "../functions";
import { secretNameSchema } from "../secrets";
import { slugify } from "../lib/slug";

export const TEMPLATE_FORMAT = "runbase-template";
export const TEMPLATE_VERSION = 1;

const slug = z.string().regex(/^[a-z0-9_.-]+$/, "slug: [a-z0-9_.-]");
const key = z.string().regex(/^[a-z0-9_-]+$/, "key: [a-z0-9_-]");

export const templateSchema = z
  .strictObject({
    format: z.literal(TEMPLATE_FORMAT),
    version: z.literal(TEMPLATE_VERSION),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000).optional(),
    databases: z
      .array(z.strictObject({ slug, name: z.string().min(1) }))
      .default([]),
    objects: z
      .array(
        z.strictObject({
          slug,
          name: z.string().min(1),
          icon: z.string().nullable().optional(),
          database: slug.optional(),
          fields: fieldsSchema,
        }),
      )
      .default([]),
    views: z
      .array(
        z.strictObject({
          object: slug,
          name: z.string().trim().min(1),
          filter: z.unknown().optional(),
          sort: z
            .array(
              z.strictObject({
                field: z.string(),
                dir: z.enum(["asc", "desc"]).optional(),
              }),
            )
            .optional(),
          columns: z.array(z.string()).nullable().optional(),
        }),
      )
      .default([]),
    functions: z.array(functionInputSchema).default([]),
    workflows: z
      .array(
        z.strictObject({
          key,
          name: z.string().min(1),
          definition: definitionSchema,
        }),
      )
      .default([]),
    pages: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          icon: z.string().optional(),
          // TSX package: { path: source } and entry point.
          files: z.record(z.string(), z.string()),
          entry: z.string().optional(),
          deps: z.record(z.string(), z.string()).optional(),
          permissions: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .default([]),
    // Names of required secrets (functions, blocks); values never exported.
    secrets: z.array(secretNameSchema).default([]),
    // Optional sample records; `key` is used by `$record:` references.
    records: z
      .array(
        z.strictObject({
          key,
          object: slug,
          externalId: z.string().nullable().optional(),
          data: z.record(z.string(), z.unknown()),
        }),
      )
      .default([]),
  })
  .superRefine((t, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const dupes = (list: string[], path: string) =>
      list.forEach((v, i) => {
        if (list.indexOf(v) !== i) issue([path, i], `duplicate: ${v}`);
      });
    dupes(
      t.objects.map((o) => o.slug),
      "objects",
    );
    dupes(
      t.functions.map((f) => f.name),
      "functions",
    );
    dupes(
      t.workflows.map((w) => w.key),
      "workflows",
    );
    dupes(
      t.records.map((r) => r.key),
      "records",
    );
    const objects = new Set(t.objects.map((o) => o.slug));
    const dbs = new Set(t.databases.map((d) => d.slug));
    t.objects.forEach((o, i) => {
      if (o.database && !dbs.has(o.database))
        issue(["objects", i, "database"], `unknown database: ${o.database}`);
    });
    t.views.forEach((v, i) => {
      if (!objects.has(v.object))
        issue(["views", i, "object"], `unknown object: ${v.object}`);
    });
    t.records.forEach((r, i) => {
      if (!objects.has(r.object))
        issue(["records", i, "object"], `unknown object: ${r.object}`);
    });
  });

export type Template = z.output<typeof templateSchema>;
export type TemplateInput = z.input<typeof templateSchema>;

// Readable zod errors: one translatable item per problem (path + message).
export function parseTemplate(raw: unknown): Template {
  let value = raw;
  if (typeof raw === "string")
    try {
      value = JSON.parse(raw);
    } catch {
      throw appError(
        "templates.invalidJson",
        "Template is not valid JSON",
        {},
        { kind: "invalid_input" },
      );
    }
  const r = templateSchema.safeParse(value);
  if (r.success) return r.data;
  const items = r.error.issues.map((i) =>
    errorItem("templates.issue", "{path}: {message}", {
      path: i.path.join(".") || "(root)",
      message: i.message,
    }),
  );
  throw appError(
    "templates.invalid",
    "Invalid template ({count} error(s)):\n{details}",
    { count: items.length, details: items.map((i) => i.message).join("\n") },
    { kind: "invalid_input", items },
  );
}

// Local references `$object:x`, `$workflow:x`, `$record:x`.
export const REF = /\$(object|workflow|record):([a-z0-9_.-]+)/g;

// Replaces, in every string of a JSON value (keys included), each
// occurrence of a key of `map` by its value.
export function rewrite<T>(value: T, map: Map<string, string>): T {
  if (!map.size) return value;
  const re = new RegExp(
    [...map.keys()]
      .sort((a, b) => b.length - a.length)
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "g",
  );
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(re, (m) => map.get(m) ?? m);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [
          k.replace(re, (m) => map.get(m) ?? m),
          walk(x),
        ]),
      );
    return v;
  };
  return walk(value) as T;
}

// Local key of a workflow from its name (unique within the template).
export function keyOf(name: string, taken: Set<string>) {
  const base = slugify(name, { fallback: "workflow" });
  let k = base;
  for (let n = 2; taken.has(k); n++) k = `${base}_${n}`;
  taken.add(k);
  return k;
}
