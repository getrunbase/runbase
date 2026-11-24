// Pure form logic (port of apps/web/app/pages/record-form.ts and
// form.ts): editable fields of an object, zod schema derived from the object
// schema (required, pattern, bounds, select, relation), entered values ->
// typed values, conditional fields and calendar grid.
import { z } from "zod";
import type { Field } from "./table";

type Row = Record<string, unknown>;
export type Option = { value: string; label: string };
// Entered value: text, boolean (checkbox) or list (multi_select, refs).
export type Input = string | boolean | string[];

const NUMERIC = new Set(["number", "currency", "percent", "rating"]);
const EDITABLE = new Set([
  "text",
  "email",
  "url",
  "phone",
  "user",
  "number",
  "currency",
  "percent",
  "rating",
  "bool",
  "date",
  "select",
  "multi_select",
  "json",
  "ref",
  "refs",
]);
// HTML <input> type per field type.
export const INPUT_TYPE: Record<string, string> = {
  email: "email",
  url: "url",
  phone: "tel",
  number: "number",
  currency: "number",
  percent: "number",
  rating: "number",
  date: "date",
};

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const keys = (v: unknown) => list(v).map(String);

// Editable fields (include = imposed order, exclude = removed).
export function formFields(
  fields: unknown,
  include?: unknown,
  exclude?: unknown,
): Field[] {
  const all = list(fields).filter(
    (f): f is Field =>
      !!f &&
      typeof f === "object" &&
      typeof (f as Row).key === "string" &&
      typeof (f as Row).type === "string",
  );
  const skip = new Set(keys(exclude));
  const ok = (f: Field) => !skip.has(f.key) && EDITABLE.has(f.type);
  const inc = keys(include);
  if (!inc.length) return all.filter(ok);
  const by = new Map(all.map((f) => [f.key, f]));
  return inc.map((k) => by.get(k)).filter((f): f is Field => !!f && ok(f));
}

const asText = (v: unknown) =>
  v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

// Initial form values from `record.data`.
export function initialValues(
  fields: Field[],
  record?: { data?: Row } | null,
): Record<string, Input> {
  const data = record?.data ?? {};
  return Object.fromEntries(
    fields.map((f) => {
      const v = data[f.key];
      if (f.type === "bool") return [f.key, v === true];
      if (f.type === "multi_select" || f.type === "refs")
        return [f.key, list(v).map(String)];
      if (f.type === "date") return [f.key, asText(v).slice(0, 10)];
      return [f.key, asText(v)];
    }),
  );
}

// Error message keys; the page provides the translated text.
export type FieldErrorKey =
  | "required"
  | "email"
  | "url"
  | "pattern"
  | "minLength"
  | "maxLength"
  | "number"
  | "min"
  | "max"
  | "option"
  | "json";
export type ErrorText = (
  key: FieldErrorKey,
  values?: Record<string, string | number>,
) => string;

const EN: Record<FieldErrorKey, string> = {
  required: "Required",
  email: "Invalid email address",
  url: "Invalid URL (https://…)",
  pattern: "Invalid format",
  minLength: "At least {min} characters",
  maxLength: "At most {max} characters",
  number: "Must be a number",
  min: "Must be at least {min}",
  max: "Must be at most {max}",
  option: "Unknown value",
  json: "Invalid JSON",
};
export const errorTextEn: ErrorText = (k, v) =>
  EN[k].replace(/\{(\w+)\}/g, (_, n: string) => String(v?.[n] ?? ""));

// Error message for an entered value, or null if valid. `options`: allowed
// values (select, loaded relation).
export function fieldError(
  f: Field,
  raw: Input | undefined,
  t: ErrorText,
  options?: string[],
): string | null {
  if (Array.isArray(raw)) {
    if (!raw.length) return f.required ? t("required") : null;
    return options && raw.some((x) => !options.includes(x))
      ? t("option")
      : null;
  }
  if (typeof raw === "boolean") return f.required && !raw ? t("required") : null;
  const v = (raw ?? "").trim();
  if (!v) return f.required ? t("required") : null;
  if (options && !options.includes(v)) return t("option");
  if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    return t("email");
  if (f.type === "url" && !/^https?:\/\/\S+$/.test(v)) return t("url");
  if (f.type === "json")
    try {
      JSON.parse(v);
    } catch {
      return t("json");
    }
  if (f.pattern) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(`^(?:${f.pattern})$`);
    } catch {
      /* invalid pattern ignored */
    }
    if (re && !re.test(v)) return t("pattern");
  }
  if (f.minLength !== undefined && v.length < f.minLength)
    return t("minLength", { min: f.minLength });
  if (f.maxLength !== undefined && v.length > f.maxLength)
    return t("maxLength", { max: f.maxLength });
  if (NUMERIC.has(f.type)) {
    const n = Number(v);
    if (Number.isNaN(n)) return t("number");
    if (f.min !== undefined && n < f.min) return t("min", { min: f.min });
    if (f.max !== undefined && n > f.max) return t("max", { max: f.max });
  }
  return null;
}

// Entered value -> typed value for records.create/update; empty = null.
export function typedValue(f: Field, raw: Input | undefined): unknown {
  if (f.type === "bool") return raw === true || raw === "true";
  if (f.type === "multi_select" || f.type === "refs")
    return Array.isArray(raw)
      ? raw
      : typeof raw === "string" && raw
        ? raw.split(",")
        : [];
  const s = typeof raw === "string" ? raw.trim() : raw;
  if (s === "" || s == null) return null;
  if (NUMERIC.has(f.type)) return Number(s);
  if (f.type === "json")
    try {
      return JSON.parse(String(s));
    } catch {
      return s;
    }
  return s;
}

export const typedValues = (fields: Field[], form: Record<string, Input>) =>
  Object.fromEntries(
    fields
      .filter((f) => f.key in form)
      .map((f) => [f.key, typedValue(f, form[f.key])]),
  );

// Form zod schema: validates each field (object rules, select or relation
// options) and returns typed values.
export function recordSchema(
  fields: Field[],
  opts: { t?: ErrorText; options?: Record<string, string[]> } = {},
) {
  const t = opts.t ?? errorTextEn;
  return z.object(
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        z
          .custom<Input>()
          .superRefine((v, ctx) => {
            const e = fieldError(
              f,
              v,
              t,
              opts.options?.[f.key] ??
                (f.type === "select" || f.type === "multi_select"
                  ? f.options
                  : undefined),
            );
            if (e) ctx.addIssue({ code: "custom", message: e });
          })
          .transform((v) => typedValue(f, v)),
      ]),
    ),
  );
}

// Display condition of a field based on the entered values:
// {field, eq} | {field, neq} | {field, in: [...]} | {field, filled: bool}.
export type ShowIf = {
  field: string;
  eq?: unknown;
  neq?: unknown;
  in?: unknown[];
  filled?: boolean;
};
export function shown(
  cond: ShowIf | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!cond) return true;
  const raw = values[cond.field];
  const v = Array.isArray(raw) ? raw.join(",") : asText(raw);
  if (cond.filled !== undefined)
    return (v !== "" && v !== "false") === cond.filled;
  if (cond.in) return cond.in.map(String).includes(v);
  if (cond.neq !== undefined) return v !== String(cond.neq);
  if (cond.eq !== undefined) return v === String(cond.eq);
  return true;
}

// Calendar: weeks (Monday first) covering the month, local ISO dates.
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  const weeks: string[][] = [];
  for (let d = new Date(start); ; ) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(isoDay(d));
      d.setDate(d.getDate() + 1);
    }
    weeks.push(week);
    if (d.getMonth() !== month) break;
  }
  return weeks;
}

// Rows grouped by day (YYYY-MM-DD) from the value of `dateOf`.
export function byDay<T>(
  rows: T[],
  dateOf: (r: T) => unknown,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const v = dateOf(r);
    if (v == null || v === "") continue;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) continue;
    const k = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : isoDay(d);
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}
