// Readable description of anything thrown by a page: an Error with an empty
// message (e.g. `new Error(undefined)`) must still say what failed.
export function describeError(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) {
    return {
      message: e.message || `${e.name || "Error"} (no message)`,
      ...(e.stack && { stack: e.stack }),
    };
  }
  if (e === undefined || e === null || e === "")
    return { message: "Unknown error (no message)" };
  if (typeof e === "object") {
    const o = e as { message?: unknown; name?: unknown; stack?: unknown };
    if (typeof o.message === "string" && o.message)
      return {
        message: o.message,
        ...(typeof o.stack === "string" && { stack: o.stack }),
      };
    try {
      return { message: JSON.stringify(e) };
    } catch {
      return { message: String(e) };
    }
  }
  return { message: String(e) };
}

const COMPONENT_STACK = "\n\nComponent stack:";

// The React component stack is appended to the error stack: page.errors
// stores a single stack, read by agents and shown in the error banner.
export function withComponentStack(
  stack: string | undefined,
  componentStack: string | null | undefined,
): string | undefined {
  const c = componentStack?.trim();
  if (!c) return stack;
  return `${stack ?? ""}${COMPONENT_STACK}\n${c}`;
}

// First useful frames and the failing component, for the error banner.
export function stackSummary(
  stack: string | undefined,
  max = 3,
): { frames: string[]; component?: string } {
  if (!stack) return { frames: [] };
  const [own = "", comp = ""] = stack.split(COMPONENT_STACK);
  const lines = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^at\s|@/.test(l));
  const all = lines(own);
  // Page code first (named runbase-page.js in the iframe), then the rest.
  const page = all.filter((l) => l.includes("runbase-page.js"));
  const frames = (page.length ? page : all).slice(0, max);
  const component = lines(comp)
    .map((l) => /^at\s+([A-Za-z_$][\w$.]*)/.exec(l)?.[1] ?? l.split("@")[0])
    .find((n) => n && n !== "Boundary");
  return component ? { frames, component } : { frames };
}
