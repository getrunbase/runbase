// Data blocks outside records: values, reshaping a JSON
// (event payload, HTTP response), dates, stop with error.
import { z } from "zod";
import { appError } from "../../errors/app-error";
import { defineBlock, StopError } from "../block";
import { parseDate } from "../../workflows/validate-hints";

// Value at the given path (`a.b.0.c`); empty path = the value itself.
export const at = (v: unknown, path?: string) =>
  path
    ? path
        .split(".")
        .reduce<unknown>(
          (o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]),
          v,
        )
    : v;

// Sets values (templates rendered by the engine) reusable later
// through `{{steps.<id>.output.<key>}}`.
export const dataSet = defineBlock({
  type: "data.set",
  label: "Set values",
  description:
    "Creates named values (text, number, variables) to reuse in the following steps.",
  sideEffect: false,
  inputSchema: z.object({ values: z.record(z.string(), z.unknown()) }),
  outputSchema: z.record(z.string(), z.unknown()),
  branches: ["ok"],
  run: async ({ values }) => ({ branch: "ok", output: values }),
});

// Reshapes an object: key <- path in `source` (e.g. `data.customer.email`).
export const dataTransform = defineBlock({
  type: "data.transform",
  label: "Reshape data",
  description:
    "Extracts fields from an object (e.g. an event's content) under new names.",
  sideEffect: false,
  inputSchema: z.object({
    source: z.unknown(),
    mapping: z.record(z.string(), z.string()),
  }),
  outputSchema: z.record(z.string(), z.unknown()),
  branches: ["ok"],
  run: async ({ source, mapping }) => ({
    branch: "ok",
    output: Object.fromEntries(
      Object.entries(mapping).map(([k, p]) => [k, at(source, p) ?? null]),
    ),
  }),
});

const UNITS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
const unit = z.enum(["minutes", "hours", "days", "weeks", "months"]);
type Unit = z.infer<typeof unit>;

// ISO date, or `now` / `today` (start of the UTC day).
function toDate(v: string) {
  const d = parseDate(v);
  if (!d) throw appError("blocks.invalidDate", "Invalid date: {value}", { value: v });
  return d;
}

export function addTo(d: Date, amount: number, u: Unit) {
  const r = new Date(d);
  if (u === "months") r.setUTCMonth(r.getUTCMonth() + amount);
  else if (u === "weeks") r.setTime(r.getTime() + amount * 7 * UNITS.days);
  else r.setTime(r.getTime() + amount * UNITS[u]);
  return r;
}

export function diff(a: Date, b: Date, u: Unit) {
  if (u === "months")
    return (
      (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
      b.getUTCMonth() -
      a.getUTCMonth()
    );
  const ms = b.getTime() - a.getTime();
  return Math.trunc(ms / (u === "weeks" ? 7 * UNITS.days : UNITS[u]));
}

// Recognized tokens (given time zone, default UTC). Text between [brackets] or
// 'quotes' stays literal; any other letter is refused (invalid pattern).
export const DATE_TOKENS =
  "yyyy/YYYY (2026), yy/YY (26), MM (03), M (3), dd/DD (05), d/D (5), HH (09, 24h), H (9), hh (09, 12h), h (9), mm (07), m (7), ss (04), s (4), a/A (AM/PM); T and Z kept as is; other literal text in [brackets] or 'quotes'";
// A repeated letter = one whole token: "MMM" is refused instead of being
// read as MM + M. T and Z stay literal (existing ISO patterns).
const TOKEN_RE = /\[[^\]]*\]|'[^']*'|([A-Za-z])\1*/g;
export function formatDate(d: Date, pattern: string, timeZone = "UTC") {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const h24 = Number(p.hour);
  const h12 = h24 % 12 || 12;
  const ampm = h24 < 12 ? "AM" : "PM";
  const map: Record<string, string> = {
    yyyy: p.year!,
    YYYY: p.year!,
    yy: p.year!.slice(-2),
    YY: p.year!.slice(-2),
    MM: p.month!,
    M: String(Number(p.month)),
    dd: p.day!,
    DD: p.day!,
    d: String(Number(p.day)),
    D: String(Number(p.day)),
    HH: p.hour!,
    H: String(h24),
    hh: String(h12).padStart(2, "0"),
    h: String(h12),
    mm: p.minute!,
    m: String(Number(p.minute)),
    ss: p.second!,
    s: String(Number(p.second)),
    a: ampm,
    A: ampm,
  };
  return pattern.replace(TOKEN_RE, (t) => {
    if (t.startsWith("[") || t.startsWith("'")) return t.slice(1, -1);
    if (Object.hasOwn(map, t)) return map[t]!;
    if (t === "T" || t === "Z") return t;
    throw appError(
      "blocks.dateFormatInvalid",
      'Invalid date format "{format}": unknown token "{token}". Supported: {tokens}',
      { format: pattern, token: t, tokens: DATE_TOKENS },
    );
  });
}

// Date computations: format, adding a duration, difference between two dates.
export const dateBlock = defineBlock({
  type: "date",
  label: "Compute a date",
  description:
    "Formats a date, adds a duration or computes the gap between two dates.",
  sideEffect: false,
  inputSchema: z.discriminatedUnion("op", [
    z.object({
      op: z.literal("format"),
      date: z.string(),
      format: z
        .string()
        .default("YYYY-MM-DD")
        .describe(`Date pattern. Tokens: ${DATE_TOKENS}`),
      timezone: z.string().optional(),
    }),
    z.object({
      op: z.literal("add"),
      date: z.string(),
      amount: z.number(),
      unit,
    }),
    z.object({
      op: z.literal("diff"),
      date: z.string(),
      to: z.string(),
      unit,
    }),
  ]),
  outputSchema: z.object({ value: z.union([z.string(), z.number()]) }),
  branches: ["ok"],
  run: async (i) => {
    const d = toDate(i.date);
    const value =
      i.op === "format"
        ? formatDate(d, i.format, i.timezone)
        : i.op === "add"
          ? addTo(d, i.amount, i.unit).toISOString()
          : diff(d, toDate(i.to), i.unit);
    return { branch: "ok", output: { value } };
  },
});

// Stops the path with an error message (no new attempt).
export const stopError = defineBlock({
  type: "stop.error",
  label: "Stop with an error",
  description:
    "Stops the workflow with an error message; the error shows up in the error center.",
  sideEffect: false,
  inputSchema: z.object({ message: z.string().min(1) }),
  outputSchema: z.object({}),
  branches: [],
  run: async ({ message }) => {
    throw new StopError(message);
  },
});
