// Leaf paths of a JSON payload (`a.b`, `items.0.email`) for the webhook
// trigger mapping. Arrays: first element only.
export function jsonPaths(v: unknown, prefix = ""): string[] {
  if (Array.isArray(v)) return v.length ? jsonPaths(v[0], `${prefix}0.`) : [];
  if (v && typeof v === "object")
    return Object.entries(v).flatMap(([k, x]) =>
      jsonPaths(x, `${prefix}${k}.`),
    );
  return prefix ? [prefix.slice(0, -1)] : [];
}

export const pickPath = (o: unknown, path: string) =>
  path
    .split(".")
    .reduce<unknown>(
      (v, k) => (v == null ? undefined : (v as Record<string, unknown>)[k]),
      o,
    );
