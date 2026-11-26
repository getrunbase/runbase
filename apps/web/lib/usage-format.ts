// Settings › Usage: locale-aware display of a meter value and its fill.
const BYTE_UNITS = [
  "byte",
  "kilobyte",
  "megabyte",
  "gigabyte",
  "terabyte",
] as const;

// Bytes in the largest decimal unit (1000) that keeps the value >= 1.
export function formatBytes(bytes: number, locale: string) {
  let v = Math.max(0, bytes);
  let i = 0;
  while (v >= 1000 && i < BYTE_UNITS.length - 1) {
    v /= 1000;
    i++;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: BYTE_UNITS[i],
    unitDisplay: "short",
    maximumFractionDigits: i === 0 ? 0 : 1,
  }).format(v);
}

export function formatMeter(key: string, value: number, locale: string) {
  if (key === "storageBytes") return formatBytes(value, locale);
  if (key === "aiBudgetUsd")
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
    }).format(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    value,
  );
}

// Progress percentage: 0 when unlimited, full when the limit is 0.
export function meterPercent(used: number, limit: number | null) {
  if (limit == null) return 0;
  if (limit <= 0) return 100;
  return Math.min(100, (used / limit) * 100);
}
