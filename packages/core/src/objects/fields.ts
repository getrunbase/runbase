// Object field types. Each type is a Zod definition schema;
// recordValidator() derives the validator of a record's values from it.
import { z } from "zod";
import { evalFormula, parseFormula } from "./formula";

const base = {
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  required: z.boolean().optional(),
  // Title field of a record: label shown everywhere.
  title: z.boolean().optional(),
  // Unique value in the object (email, domain, external id): database
  // constraint (record_keys) and upsert key (`match`). Scalar types only.
  unique: z.boolean().optional(),
  // Validation: pattern (regex, texts), bounds (numbers), length (texts).
  pattern: z
    .string()
    .refine((p) => {
      try {
        new RegExp(p);
        return true;
      } catch {
        return false;
      }
    }, "Invalid regular expression")
    .optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  // Value written at creation when the field is not provided.
  default: z.json().optional(),
};
export const UNIQUE_TYPES = ["text", "email", "url", "number", "phone"];
const rel = z.string().regex(/^[a-z][a-z0-9_:]*$/);
const options = z.array(z.string().min(1)).min(1);

export const fieldSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("text") }),
  z.object({ ...base, type: z.literal("number") }),
  z.object({ ...base, type: z.literal("bool") }),
  z.object({ ...base, type: z.literal("date") }),
  z.object({ ...base, type: z.literal("select"), options }),
  z.object({ ...base, type: z.literal("multi_select"), options }),
  z.object({ ...base, type: z.literal("email") }),
  z.object({ ...base, type: z.literal("url") }),
  z.object({ ...base, type: z.literal("json") }),
  // Reference to a record of another object (target slug).
  z.object({ ...base, type: z.literal("ref"), object: z.string().min(1) }),
  // Multiple references: list of record ids of the target object.
  z.object({ ...base, type: z.literal("refs"), object: z.string().min(1) }),
  // Amount (number) shown with its ISO 4217 currency (EUR by default).
  z.object({
    ...base,
    type: z.literal("currency"),
    currency: z.string().length(3).optional(),
  }),
  // Percentage stored as displayed: 12.5 = 12.5 %.
  z.object({ ...base, type: z.literal("percent") }),
  z.object({ ...base, type: z.literal("phone") }),
  // Integer rating from 0 to `scale` (5 by default).
  z.object({
    ...base,
    type: z.literal("rating"),
    scale: z.number().int().min(1).max(10).optional(),
  }),
  // Workspace member (user id or email).
  z.object({ ...base, type: z.literal("user") }),
  // Attached files: list of { key, name, size, type } (files.upload).
  z.object({ ...base, type: z.literal("file") }),
  // Computed fields: never entered, any written value is ignored.
  // formula: expression over the record fields (see formula.ts),
  // recomputed on each write; `result` drives filters and sorting.
  z.object({
    ...base,
    type: z.literal("formula"),
    formula: z
      .string()
      .min(1)
      .refine((f) => {
        try {
          parseFormula(f);
          return true;
        } catch {
          return false;
        }
      }, "Invalid formula"),
    result: z.enum(["text", "number", "bool", "date"]).optional(),
  }),
  // lookup: value of a field of the record(s) linked by `through`
  // (ref/refs field, or inverse relation `<object>` / `<object>:<field>`).
  z.object({
    ...base,
    type: z.literal("lookup"),
    through: rel,
    field: z.string().min(1),
  }),
  // rollup: aggregate of the records linked by `through` (count without `field`).
  z.object({
    ...base,
    type: z.literal("rollup"),
    through: rel,
    field: z.string().min(1).optional(),
    op: z.enum(["count", "sum", "avg", "min", "max"]),
  }),
  z.object({ ...base, type: z.literal("created_at") }),
  z.object({ ...base, type: z.literal("updated_at") }),
  z.object({ ...base, type: z.literal("created_by") }),
  // Sequential number assigned at creation (1, 2, 3…).
  z.object({ ...base, type: z.literal("autonumber") }),
]);

export type Field = z.infer<typeof fieldSchema>;

// Types whose value is computed by the platform.
export const COMPUTED: Field["type"][] = [
  "formula",
  "lookup",
  "rollup",
  "created_at",
  "updated_at",
  "created_by",
  "autonumber",
];
// Computed on read (depend on other records): neither stored nor filterable.
export const VIRTUAL: Field["type"][] = ["lookup", "rollup"];
export const isComputed = (f: Field) => COMPUTED.includes(f.type);

// Base type of a field for filters, sorting and conversions.
export type BaseType =
  | "text"
  | "number"
  | "bool"
  | "date"
  | "select"
  | "multi_select"
  | "json"
  | "ref"
  | "refs"
  | "virtual"
  | "file";
export function baseType(f: Field): BaseType {
  switch (f.type) {
    case "email":
    case "url":
    case "phone":
    case "user":
    case "created_by":
      return "text";
    case "currency":
    case "percent":
    case "rating":
    case "autonumber":
      return "number";
    case "created_at":
    case "updated_at":
      return "date";
    case "formula":
      return f.result ?? "text";
    case "lookup":
    case "rollup":
      return "virtual";
    default:
      return f.type;
  }
}

export const fieldsSchema = z
  .array(fieldSchema)
  .refine((f) => new Set(f.map((x) => x.key)).size === f.length, {
    message: "Duplicate field keys",
  })
  .refine((f) => f.every((x) => !x.unique || UNIQUE_TYPES.includes(x.type)), {
    message: `unique: types ${UNIQUE_TYPES.join(", ")} only`,
  });

// Normalized value of a unique field (null = no key): email
// lowercased, text trimmed.
export function uniqueValue(f: Field, v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!s) return null;
  return f.type === "email" ? s.toLowerCase() : s;
}

const fileSchema = z.array(
  z.object({
    key: z.string().min(1),
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
    type: z.string(),
  }),
);

// Shared validation constraints (pattern, length, bounds).
function constrain(f: Field, s: z.ZodType): z.ZodType {
  if (s instanceof z.ZodNumber) {
    let out: z.ZodNumber = s;
    if (f.min !== undefined) out = out.min(f.min);
    if (f.max !== undefined) out = out.max(f.max);
    return out;
  }
  if (f.minLength === undefined && f.maxLength === undefined && !f.pattern)
    return s;
  // Texts (email, URL, phone included): length and pattern.
  const re = f.pattern ? new RegExp(f.pattern) : null;
  return s.superRefine((v, c) => {
    if (typeof v !== "string") return;
    if (f.minLength !== undefined && v.length < f.minLength)
      c.addIssue({
        code: "custom",
        message: `${f.label}: ${f.minLength} characters minimum`,
      });
    if (f.maxLength !== undefined && v.length > f.maxLength)
      c.addIssue({
        code: "custom",
        message: `${f.label}: ${f.maxLength} characters maximum`,
      });
    if (re && !re.test(v))
      c.addIssue({
        code: "custom",
        message: `${f.label}: invalid format (${f.pattern})`,
      });
  });
}

// Problem with a value written to a field (null when valid), e.g. an
// invalid email or an unknown select option.
export function valueProblem(f: Field, v: unknown): string | null {
  const r = valueSchema(f).safeParse(v);
  return r.success ? null : (r.error.issues[0]?.message ?? "invalid value");
}

function valueSchema(f: Field): z.ZodType {
  if (isComputed(f)) return z.unknown();
  return constrain(f, rawSchema(f));
}

function rawSchema(f: Field): z.ZodType {
  switch (f.type) {
    case "text":
      return f.required ? z.string().min(1) : z.string();
    case "number":
    case "currency":
    case "percent":
      return z.number();
    case "rating":
      return z
        .number()
        .int()
        .min(0)
        .max(f.scale ?? 5);
    case "phone":
      return z.string().regex(/^\+?[0-9 ().-]{3,}$/, "Invalid phone number");
    case "user":
      return z.string().min(1);
    case "file":
      return fileSchema;
    case "bool":
      return z.boolean();
    case "date":
      return z.iso.date().or(z.iso.datetime());
    case "select":
      return z.enum(f.options);
    case "multi_select":
      return z.array(z.enum(f.options));
    case "email":
      return z.email();
    case "url":
      return z.url();
    case "json":
      return z.json();
    case "ref":
      return z.uuid();
    case "refs":
      return z.array(z.uuid());
    default:
      return z.unknown();
  }
}

// Values entered in a form (always strings): "" -> null except for
// text, number and boolean converted from their textual form. Other
// values are left as is (validation decides).
export function coerceValues(
  fields: Field[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...data };
  for (const f of fields) {
    // Computed fields: the entered value is ignored.
    if (isComputed(f)) {
      delete out[f.key];
      continue;
    }
    const v = out[f.key];
    if (typeof v !== "string") continue;
    const b = baseType(f);
    if (v === "" && b !== "text") out[f.key] = null;
    else if (b === "number" && v.trim() !== "" && !Number.isNaN(Number(v)))
      out[f.key] = Number(v);
    else if (f.type === "bool" && (v === "true" || v === "false"))
      out[f.key] = v === "true";
    // Form multiselect: values joined by commas.
    else if (f.type === "multi_select" || f.type === "refs")
      out[f.key] = v.split(",").filter(Boolean);
  }
  return out;
}

// Default values of missing fields, at creation.
export function withDefaults(fields: Field[], data: Record<string, unknown>) {
  const out = { ...data };
  for (const f of fields)
    if (f.default !== undefined && out[f.key] == null && !isComputed(f))
      out[f.key] = f.default;
  return out;
}

// Stored computed fields: created_at / created_by at creation, formulas on
// each write. updated_at is set by the caller when the record changes.
export function applyComputed(
  fields: Field[],
  data: Record<string, unknown>,
  opts: { created?: { at: string; by: string } } = {},
) {
  const out = { ...data };
  for (const f of fields) {
    if (opts.created && f.type === "created_at") out[f.key] = opts.created.at;
    if (opts.created && f.type === "updated_at") out[f.key] = opts.created.at;
    if (opts.created && f.type === "created_by") out[f.key] = opts.created.by;
    if (VIRTUAL.includes(f.type)) delete out[f.key];
  }
  // Formulas in schema order: a formula can read the previous one.
  for (const f of fields)
    if (f.type === "formula") out[f.key] = evalFormula(f.formula, out);
  return out;
}

// Unknown fields kept (looseObject): changing the schema does not break
// existing records.
export function recordValidator(fields: Field[]) {
  return z.looseObject(
    Object.fromEntries(
      fields.map((f) => {
        const s = valueSchema(f);
        return [f.key, f.required ? s : s.nullish()];
      }),
    ),
  );
}

// Label of a record: its title field, otherwise the first text value,
// otherwise the start of its id.
export function recordTitle(
  fields: Field[],
  r: { id: string; data: Record<string, unknown> },
) {
  const key = fields.find((f) => f.title)?.key;
  const v =
    (key && r.data[key]) ||
    Object.values(r.data).find((x) => typeof x === "string" && x);
  return typeof v === "string" && v ? v : r.id.slice(0, 8);
}
