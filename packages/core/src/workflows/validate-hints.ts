// Static checks that catch, at save time, mistakes that otherwise only
// show up at run time: block type typos, invalid regex patterns, invalid
// literal dates, placeholder recipients, orphan webhook records.
import { errorItem, type ErrorItem } from "../errors/app-error";
import { isTemplate, type Step } from "./validate-shared";

// Common wrong names (MCP tool names, plural forms) for native blocks.
const ALIASES: Record<string, string> = {
  "records.update": "record.update",
  "records.upsert": "record.upsert",
  "records.search": "record.search",
  "records.create": "record.upsert",
  "record.create": "record.upsert",
  "records.get": "record.search",
  "events.push": "event.emit",
  "event.push": "event.emit",
  "events.emit": "event.emit",
  "http.get": "http.request",
  "http.post": "http.request",
  http: "http.request",
  if: "condition",
  "stop.fail": "stop.error",
  error: "stop.error",
};

export function levenshtein(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length]!;
}

// Closest known block type: alias first, then edit distance (at most a
// third of the length, minimum 2).
export function suggestBlock(type: string, known: string[]) {
  const alias = ALIASES[type];
  if (alias && known.includes(alias)) return alias;
  let best: string | undefined;
  let score = Math.max(2, Math.floor(type.length / 3)) + 1;
  for (const k of known) {
    const d = levenshtein(type, k);
    if (d < score) [best, score] = [k, d];
  }
  return best;
}

export function unknownBlockError(step: string, type: string, known: string[]) {
  const suggestion = suggestBlock(type, known);
  return suggestion
    ? errorItem(
        "workflows.unknownBlockSuggest",
        "{step}: unknown block {type}, did you mean {suggestion}? (blocks.list)",
        { step, type, suggestion },
      )
    : errorItem("workflows.unknownBlock", "{step}: unknown block {type}", {
        step,
        type,
      });
}

// JavaScript regex flags accepted by the value-mode regex operator.
export const regexFlags = (i: { flags?: string; caseInsensitive?: boolean }) =>
  [...new Set(`${i.flags ?? ""}${i.caseInsensitive ? "i" : ""}`)].join("");

const regexError = (step: string, pattern: string, e: unknown) =>
  errorItem(
    "workflows.invalidRegex",
    "{step}: invalid regex {pattern}: {message}",
    { step, pattern, message: e instanceof Error ? e.message : String(e) },
  );

// Value-mode condition / switch with op regex: the pattern (and flags)
// compiled as JavaScript runs it.
export function regexChecks(steps: Step[], errors: ErrorItem[]) {
  const tryCompile = (step: string, p: unknown, flags: string) => {
    if (typeof p !== "string" || isTemplate(p)) return;
    try {
      new RegExp(p, flags);
    } catch (e) {
      errors.push(regexError(step, p, e));
    }
  };
  for (const s of flatten(steps)) {
    const i = (s.input ?? {}) as Record<string, unknown>;
    if (s.type === "condition" && !("object" in i) && i.op === "regex")
      tryCompile(s.id, i.right, regexFlags(i));
    if (s.type === "switch" && !("object" in i) && Array.isArray(i.cases))
      for (const c of i.cases as Record<string, unknown>[])
        if (c?.op === "regex") tryCompile(s.id, c.value, regexFlags(c));
  }
}

// Date strings the date block accepts: ISO / Date.parse, `now`, `today`.
export function parseDate(v: string, now = new Date()) {
  const k = v.trim().toLowerCase();
  if (k === "now") return new Date(now);
  if (k === "today")
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function dateChecks(steps: Step[], errors: ErrorItem[]) {
  for (const s of flatten(steps)) {
    if (s.type !== "date") continue;
    const i = (s.input ?? {}) as Record<string, unknown>;
    for (const k of ["date", "to"])
      if (
        typeof i[k] === "string" &&
        !isTemplate(i[k]) &&
        !parseDate(i[k] as string)
      )
        errors.push(
          errorItem(
            "workflows.invalidDate",
            '{step}.{field}: invalid date {value} (ISO date, "now", "today" or a {{…}} template)',
            { step: s.id, field: k, value: i[k] as string },
          ),
        );
  }
}

const PLACEHOLDER = /(^|[@.\s/])example\.(com|org|net)\b/i;
const SENDER = /(^|\.)(gmail|email|mail|smtp|outlook|slack)(\.|$)/;

// Send block (gmail, email, slack) whose input still targets a
// placeholder domain: the message would go nowhere (or to a stranger).
export function placeholderRecipientChecks(
  steps: Step[],
  warnings: ErrorItem[],
) {
  for (const s of flatten(steps)) {
    if (!SENDER.test(s.type)) continue;
    const i = (s.input ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(i)) {
      const values = Array.isArray(v) ? v : [v];
      const hit = values.find((x) => typeof x === "string" && PLACEHOLDER.test(x));
      if (hit && /^(to|cc|bcc|recipients?|email|channel|from|replyTo)$/i.test(k))
        warnings.push(
          errorItem(
            "workflows.placeholderRecipient",
            "{step}.{field}: placeholder recipient {value}; set a real address before activating",
            { step: s.id, field: k, value: hit as string },
          ),
        );
    }
  }
}

// trigger.webhook with object + mapping writes the record before the run
// starts: a stop.error path then leaves that record behind.
export function orphanUpsertWarnings(
  trigger: { type: string; object?: string; mapping?: unknown } | undefined,
  steps: Step[],
  warnings: ErrorItem[],
) {
  if (trigger?.type !== "trigger.webhook" || !trigger.object || !trigger.mapping)
    return;
  for (const s of flatten(steps))
    if (s.type === "stop.error")
      warnings.push(
        errorItem(
          "workflows.orphanWebhookRecord",
          "{step}: stop.error runs after trigger.webhook already created or updated the {object} record; validate the payload in a condition before writing, or delete the record on that path",
          { step: s.id, object: trigger.object },
        ),
      );
}

// Steps including those nested in a loop (`do`).
function flatten(steps: Step[]): Step[] {
  return steps.flatMap((s) => {
    const inner = (s.input as { do?: unknown } | undefined)?.do;
    return s.type === "loop" && Array.isArray(inner)
      ? [s, ...flatten(inner as Step[])]
      : [s];
  });
}
