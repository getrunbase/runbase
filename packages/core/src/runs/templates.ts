// Input templates with relation paths: `{{record.nom}}`,
// `{{record.contact.entreprise.nom}}`, `{{steps.x.output.record.contact.nom}}`.
// Paths that are not record properties (id, data…) are
// resolved through recordsService.resolvePaths: one transaction per root record.
import { render } from "../blocks/render";
import { recordsService } from "../records";
import type { TenantContext } from "../tenant";

const TEMPLATE = /\{\{([^}]+)\}\}/g;

// Built-in variables, available in every step: `{{now}}` (ISO),
// `{{today}}` (AAAA-MM-JJ, UTC), `{{run.id}}`, `{{run.test}}`, `{{workflow.id}}`.
export const builtins = (ids: {
  runId?: string;
  workflowId?: string;
  test?: boolean;
}) => {
  const now = new Date().toISOString();
  return {
    now,
    today: now.slice(0, 10),
    run: { id: ids.runId ?? null, test: ids.test ?? false },
    workflow: { id: ids.workflowId ?? null },
  };
};

// Known roots of a template (except `steps.<id>`, checked separately).
export const TEMPLATE_ROOTS = new Set([
  "record",
  "event",
  "steps",
  "now",
  "today",
  "run",
  "workflow",
  "secret",
  "depth",
]);
const ROOT = /^(record|steps\.[^.]+\.output\.record)\.(.+)$/;

export function paths(value: unknown, acc = new Set<string>()): Set<string> {
  if (typeof value === "string")
    for (const m of value.matchAll(TEMPLATE)) acc.add(m[1]!.trim());
  else if (Array.isArray(value)) value.forEach((v) => paths(v, acc));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => paths(v, acc));
  return acc;
}

const at = (scope: unknown, path: string) =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]),
      scope,
    );

export async function renderInputs(
  ctx: TenantContext,
  value: unknown,
  scope: Record<string, unknown>,
) {
  const byRecord = new Map<string, Map<string, string>>();
  for (const p of paths(value)) {
    const m = p.match(ROOT);
    if (!m) continue;
    const rec = at(scope, m[1]!) as { id?: unknown } | null | undefined;
    const first = m[2]!.split(".")[0]!;
    if (!rec || typeof rec.id !== "string" || first in rec) continue;
    const wanted = byRecord.get(rec.id) ?? new Map<string, string>();
    wanted.set(p, m[2]!);
    byRecord.set(rec.id, wanted);
  }
  const resolved = new Map<string, unknown>();
  for (const [id, wanted] of byRecord) {
    const values = await recordsService.resolvePaths(ctx, id, [
      ...new Set(wanted.values()),
    ]);
    for (const [full, rel] of wanted) resolved.set(full, values[rel]);
  }
  return render(value, scope, resolved);
}

// Rendered step inputs (relations included), except the block's `raw` keys.
export async function stepInput(
  ctx: TenantContext,
  input: unknown,
  raw: Set<string>,
  scope: Record<string, unknown>,
) {
  const entries = Object.entries((input ?? {}) as Record<string, unknown>);
  const rendered = (await renderInputs(
    ctx,
    Object.fromEntries(entries.filter(([k]) => !raw.has(k))),
    scope,
  )) as Record<string, unknown>;
  return Object.fromEntries(
    entries.map(([k, v]) => [k, raw.has(k) ? v : rendered[k]]),
  );
}
