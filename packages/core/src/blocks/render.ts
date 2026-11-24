// `{{a.b.c}}`: replaced by the value at the path; alone in the string, keeps its type.
// `{{secret.X}}` stays literal if the scope has no `secret`: only the block
// resolves it at call time, so it is never persisted in the steps.
// `resolved`: values precomputed by path (relations, see runs/templates).
export function render(
  value: unknown,
  scope: Record<string, unknown>,
  resolved?: Map<string, unknown>,
): unknown {
  const SECRET = /(\{\{\s*secret\.[^}]+\}\})/;
  if (typeof value === "string" && !("secret" in scope) && SECRET.test(value))
    return value
      .split(SECRET)
      .map((part, i) =>
        i % 2 ? part : String(renderPart(part, scope, resolved) ?? ""),
      )
      .join("");
  return renderPart(value, scope, resolved);
}

function renderPart(
  value: unknown,
  scope: Record<string, unknown>,
  resolved?: Map<string, unknown>,
): unknown {
  const get = (path: string) =>
    resolved?.has(path.trim())
      ? resolved.get(path.trim())
      : path
          .trim()
          .split(".")
          .reduce<unknown>(
            (o, k) =>
              o == null ? undefined : (o as Record<string, unknown>)[k],
            scope,
          );
  if (typeof value === "string") {
    const whole = value.match(/^\{\{([^}]+)\}\}$/);
    if (whole) return get(whole[1]!);
    return value.replace(/\{\{([^}]+)\}\}/g, (_, p) => String(get(p) ?? ""));
  }
  if (Array.isArray(value)) return value.map((v) => render(v, scope, resolved));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, render(v, scope, resolved)]),
    );
  return value;
}
