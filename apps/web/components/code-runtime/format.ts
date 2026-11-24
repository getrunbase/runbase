// Formatting exposed to code components (`format` from @getrunbase/sdk), in the
// user's locale passed at iframe init (default: en).
let locale = "en";
export function setFormatLocale(l: unknown) {
  if (typeof l !== "string" || !l) return;
  try {
    locale = Intl.getCanonicalLocales(l)[0] ?? "en";
  } catch {
    // Invalid locale: keep the previous one.
  }
}
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, o);
const toDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];
const rtf = () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

export const format = {
  // "3 days ago", "in 2 hours", "just now"
  relative(v: unknown, now = Date.now()) {
    const s = (toDate(v).getTime() - now) / 1000;
    if (Number.isNaN(s)) return "";
    if (Math.abs(s) < 45) return rtf().format(0, "second");
    const [unit, n] = UNITS.find(([, n]) => Math.abs(s) >= n)!;
    return rtf().format(Math.round(s / n), unit);
  },
  date(
    v: unknown,
    style: "short" | "medium" | "long" | "time" | "datetime" = "medium",
  ) {
    const d = toDate(v);
    if (Number.isNaN(d.getTime())) return "";
    if (style === "time")
      return d.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      });
    if (style === "datetime")
      return d.toLocaleString(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    return d.toLocaleDateString(locale, { dateStyle: style });
  },
  currency(v: unknown, currency = "EUR", opts: { compact?: boolean } = {}) {
    return nf({
      style: "currency",
      currency,
      maximumFractionDigits: opts.compact ? 1 : Number(v) % 1 ? 2 : 0,
      notation: opts.compact ? "compact" : "standard",
    }).format(Number(v ?? 0));
  },
  number(v: unknown, digits = 0, opts: { compact?: boolean } = {}) {
    return nf({
      maximumFractionDigits: digits,
      notation: opts.compact ? "compact" : "standard",
    }).format(Number(v ?? 0));
  },
  // 0.256 -> "25.6%"
  percent(v: unknown, digits = 0) {
    return nf({ style: "percent", maximumFractionDigits: digits }).format(
      Number(v ?? 0),
    );
  },
};
