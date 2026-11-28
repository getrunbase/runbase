// Formatter: pure transformations of a value (text, number, date,
// utilities), no AI or network. Output { value }.
import { z } from "zod";
import { defineBlock } from "../block";
import { appError } from "../../errors/app-error";
import { addTo, DATE_TOKENS, diff, formatDate } from "./data";
import { slugify } from "../../lib/slug";

const unit = z.enum(["minutes", "hours", "days", "weeks", "months"]);
const input = z.unknown();
const op = <T extends string, S extends z.ZodRawShape = Record<never, never>>(
  name: T,
  shape: S = {} as S,
) => z.object({ op: z.literal(name), input }).extend(shape);

const inputSchema = z.discriminatedUnion("op", [
  op("text.upper"),
  op("text.lower"),
  op("text.capitalize"),
  op("text.trim"),
  op("text.replace", {
    find: z.string().min(1),
    replace: z.string().default(""),
  }),
  op("text.split", {
    separator: z.string().default(","),
    index: z.number().int().optional(),
  }),
  op("text.truncate", { length: z.number().int().min(0) }),
  op("text.extract_email"),
  op("text.extract_url"),
  op("text.extract_number"),
  op("text.slugify"),
  op("text.default", { value: z.unknown() }),
  op("number.parse"),
  op("number.format", {
    locale: z.string().default("en-US"),
    decimals: z.number().int().min(0).max(20).optional(),
    currency: z.string().length(3).optional(),
  }),
  op("number.round", { decimals: z.number().int().min(0).max(20).default(0) }),
  op("number.math", {
    operator: z.enum(["+", "-", "*", "/"]),
    operand: z.unknown(),
  }),
  op("date.parse"),
  op("date.format", {
    format: z
      .string()
      .default("ISO")
      .describe(
        `"ISO", "date", "datetime" (locale styles) or a pattern. Tokens: ${DATE_TOKENS}`,
      ),
    timezone: z.string().optional(),
    locale: z.string().default("en-US"),
  }),
  op("date.add", { amount: z.number(), unit }),
  op("date.diff", { other: z.string(), unit }),
  op("utility.lookup", {
    table: z.record(z.string(), z.unknown()),
    fallback: z.unknown().optional(),
  }),
  op("utility.pick_first"),
  op("utility.to_list", { separator: z.string().default(",") }),
  op("utility.join", { separator: z.string().default(", ") }),
]);
type Input = z.infer<typeof inputSchema>;

const isEmpty = (v: unknown) =>
  v == null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);
const str = (v: unknown) => (v == null ? "" : String(v));

const invalid = (op: string, input: unknown): never => {
  throw appError(
    "blocks.formatterInvalid",
    'Formatter {op}: invalid input "{input}"',
    {
      op,
      input: str(typeof input === "object" ? JSON.stringify(input) : input),
    },
  );
};

// Number from text: "1 234,5" / "1,234.5" / "$12"; null if empty.
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (isEmpty(v)) return null;
  let s = str(v).replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes("."))
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = s === "" ? NaN : Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const num = (o: string, v: unknown) => {
  const n = toNumber(v);
  return n === null || Number.isNaN(n) ? invalid(o, v) : n;
};
const date = (o: string, v: unknown) => {
  const d = new Date(v instanceof Date ? v : str(v));
  return Number.isNaN(d.getTime()) ? invalid(o, v) : d;
};
const toList = (v: unknown, sep: string): unknown[] =>
  Array.isArray(v)
    ? v
    : isEmpty(v)
      ? []
      : str(v)
          .split(sep)
          .map((s) => s.trim())
          .filter(Boolean);

export function format(i: Input): unknown {
  const v = i.input;
  const s = str(v);
  const o = i.op as string;
  if (o.startsWith("text.") && o !== "text.default" && v == null)
    return o.startsWith("text.extract") ? null : "";
  // number.math fails on a null input instead (a silent null result hides an
  // unresolved template).
  if (
    (o.startsWith("number.") || o.startsWith("date.")) &&
    o !== "number.math" &&
    isEmpty(v)
  )
    return null;
  switch (i.op) {
    case "text.upper":
      return s.toUpperCase();
    case "text.lower":
      return s.toLowerCase();
    case "text.capitalize":
      return s
        .toLowerCase()
        .replace(/(^|[\s\-'])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
    case "text.trim":
      return s.trim();
    case "text.replace":
      return s.split(i.find).join(i.replace);
    case "text.split": {
      const parts = s.split(i.separator);
      return i.index === undefined ? parts : (parts.at(i.index) ?? null);
    }
    case "text.truncate":
      return s.length > i.length ? s.slice(0, i.length) : s;
    case "text.extract_email":
      return s.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0] ?? null;
    case "text.extract_url":
      return (
        s.match(/https?:\/\/[^\s<>"')]+/)?.[0].replace(/[.,;:!?]+$/, "") ?? null
      );
    case "text.extract_number": {
      const m = s
        .match(/-?\d[\d\s.,]*/)?.[0]
        .trim()
        .replace(/[.,]$/, "");
      return m ? toNumber(m.replace(/\s/g, "")) : null;
    }
    case "text.slugify":
      return slugify(s, { separator: "-" });
    case "text.default":
      return isEmpty(v) ? i.value : v;
    case "number.parse":
      return num(i.op, v);
    case "number.format":
      return new Intl.NumberFormat(i.locale, {
        ...(i.currency ? { style: "currency", currency: i.currency } : {}),
        ...(i.decimals !== undefined
          ? {
              minimumFractionDigits: i.decimals,
              maximumFractionDigits: i.decimals,
            }
          : {}),
      }).format(num(i.op, v));
    case "number.round": {
      const f = 10 ** i.decimals;
      return Math.round(num(i.op, v) * f) / f;
    }
    case "number.math": {
      // A null operand usually means an unresolved template: say so.
      for (const [side, x] of [
        ["input", v],
        ["operand", i.operand],
      ] as const)
        if (
          x === null ||
          x === undefined ||
          (typeof x === "string" && !x.trim())
        )
          throw appError(
            "blocks.formatterNullOperand",
            "Formatter {op}: {side} is null (check the template it comes from)",
            { op: i.op, side },
          );
      const a = num(i.op, v),
        b = num(i.op, i.operand);
      if (i.operator === "/" && b === 0) return invalid(i.op, i.operand);
      return i.operator === "+"
        ? a + b
        : i.operator === "-"
          ? a - b
          : i.operator === "*"
            ? a * b
            : a / b;
    }
    case "date.parse":
      return date(i.op, v).toISOString();
    case "date.format": {
      const d = date(i.op, v);
      const tz = i.timezone ?? "UTC";
      if (i.format === "ISO") return d.toISOString();
      if (i.format === "date" || i.format === "datetime")
        return new Intl.DateTimeFormat(i.locale, {
          timeZone: tz,
          dateStyle: "medium",
          ...(i.format === "datetime" ? { timeStyle: "short" } : {}),
        }).format(d);
      return formatDate(d, i.format, tz);
    }
    case "date.add":
      return addTo(date(i.op, v), i.amount, i.unit).toISOString();
    case "date.diff":
      return diff(date(i.op, v), date(i.op, i.other), i.unit);
    case "utility.lookup": {
      const k = str(v);
      return Object.hasOwn(i.table, k) ? i.table[k] : (i.fallback ?? null);
    }
    case "utility.pick_first":
      return (Array.isArray(v) ? v : [v]).find((x) => !isEmpty(x)) ?? null;
    case "utility.to_list":
      return toList(v, i.separator);
    case "utility.join":
      return toList(v, ",")
        .filter((x) => !isEmpty(x))
        .map(str)
        .join(i.separator);
  }
}

export const formatter = defineBlock({
  type: "formatter",
  label: "Format a value",
  description:
    "Transforms a value without AI: text (case, replace, split, extract email/URL/number, slug), number (parse, format, round, math), date (parse, format, add, diff), lookup table, first non-empty, list/join.",
  sideEffect: false,
  inputSchema,
  outputSchema: z.object({ value: z.unknown() }),
  branches: ["ok"],
  run: async (i) => ({ branch: "ok", output: { value: format(i) } }),
});
