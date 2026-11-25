// Usage meter helpers (pure, unit tested).

// Percent of the limit used, capped at 100; null when unlimited.
export const usagePercent = (used: number, limit: number | null) =>
  limit == null ? null : limit > 0 ? Math.min(100, (used / limit) * 100) : 100;

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

// Largest decimal byte unit (Intl unit identifier) that keeps n >= 1.
export function byteUnit(bytes: number) {
  let i = 0;
  let n = bytes;
  while (n >= 1000 && i < UNITS.length - 1) {
    n /= 1000;
    i++;
  }
  return { unit: UNITS[i]!, n };
}
