// Cleanup of error messages before storage: ANSI sequences
// (Deno colors), temporary sandbox paths, truncated stack, and
// stable fingerprint to group identical errors. No dependency.
import { createHash } from "node:crypto";

// CSI/OSC sequences (ESC[…m, ESC]…BEL) and lone ESC.
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b/g;
export const stripAnsi = (s: string) => s.replace(ANSI, "");

// file:///tmp/fn-AbC123/fn.ts:3:9 -> fn.ts:3:9 (line:column kept);
// also works without a scheme (/private/var/…/fn-xxx/main.ts).
const SANDBOX_PATH =
  /(?:file:\/\/)?\/[^\s()'"`]*?\/fn-[A-Za-z0-9_]+\/([\w.-]+)/g;
export const normalizePaths = (s: string) => s.replace(SANDBOX_PATH, "$1");

// Server absolute paths in a stack (/home/app/packages/core/src/x.ts:3:9,
// file:///srv/…/node_modules/pkg/y.js) -> path from the repository root or
// node_modules, otherwise the file name: no host layout leaked.
const ABS_PATH =
  /(?:file:\/\/)?(?:\/[^\s()'"`:/]+)+\/([^\s()'"`:/]+)/g;
const ROOTS = /\/((?:node_modules|packages|apps)\/.*)$/;
export const stripServerPaths = (s: string) =>
  s.replace(ABS_PATH, (m, file: string) => {
    const rel = m.replace(/^file:\/\//, "").match(ROOTS);
    return rel ? rel[1]! : file;
  });

// Stack ready to store or show: sandbox and server paths removed, bounded.
export const cleanStack = (s: string) =>
  truncateStack(stripServerPaths(normalizePaths(stripAnsi(s))));

// A zod error message is the JSON dump of its issues: rendered as
// `field: message` lines. Any other message is returned unchanged.
export function formatIssues(message: string): string {
  if (!message.trimStart().startsWith("[")) return message;
  try {
    const issues = JSON.parse(message) as unknown;
    if (
      !Array.isArray(issues) ||
      !issues.length ||
      !issues.every(
        (i) =>
          i && typeof i.message === "string" && Array.isArray(i.path),
      )
    )
      return message;
    return (issues as { path: (string | number)[]; message: string }[])
      .map(
        (i) =>
          `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message.replace(/^Invalid input: /, "")}`,
      )
      .join("\n");
  } catch {
    return message;
  }
}

export const STACK_LIMITS = { lines: 20, bytes: 4096 };

export function truncateStack(
  s: string,
  { lines, bytes } = STACK_LIMITS,
): string {
  const all = s.split("\n");
  let out = all.slice(0, lines).join("\n");
  if (Buffer.byteLength(out) > bytes)
    out = Buffer.from(out).subarray(0, bytes).toString().replace(/�$/, "");
  return out.length < s.length ? `${out}\n… (truncated)` : out;
}

// ANSI and paths removed (function logs: no truncation here).
export const cleanText = (s: string) => normalizePaths(stripAnsi(s));

// Storable error message: cleaned and bounded.
export const cleanError = (s: string) => truncateStack(cleanText(s));

// Fingerprint: cleaned message without identifiers (uuid, hex, numbers),
// lowercased, whitespace collapsed. Two occurrences of the same failure share it.
export function fingerprint(message: string): string {
  const norm = cleanText(message)
    .toLowerCase()
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      "<id>",
    )
    .replace(/\b[0-9a-f]{8,}\b/g, "<id>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}
