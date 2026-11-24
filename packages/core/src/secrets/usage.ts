// Where a secret is referenced: bindings only store the name,
// so renaming or deleting a used secret must warn the user.
import { and, eq, sql } from "drizzle-orm";
import { requireScope } from "../api-keys";
import { workspaceAi } from "../ai-providers";
import {
  functions,
  webhooks,
  workflows,
  workflowVersions,
} from "../db/schema";
import { withTenant, type TenantContext } from "../tenant";

export type SecretUsage = {
  type: "workflow" | "function" | "webhook" | "ai";
  id: string;
  name: string;
};

const TEMPLATE = /\{\{\s*secret\.([A-Za-z0-9_]+)\s*\}\}/g;

// Secret names referenced in a value: `{{secret.X}}` in a string,
// or a `secret` field holding a name (HMAC block).
export function secretRefs(value: unknown, out = new Set<string>()) {
  if (typeof value === "string")
    for (const m of value.matchAll(TEMPLATE)) out.add(m[1]!);
  else if (Array.isArray(value)) for (const v of value) secretRefs(v, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      if (k === "secret" && typeof v === "string" && /^[A-Za-z0-9_]+$/.test(v))
        out.add(v);
      secretRefs(v, out);
    }
  return out;
}

export const secretUsageService = {
  // Secret name -> usages (current version of workflows, latest version
  // of functions, incoming webhooks, AI setting).
  all: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const out: Record<string, SecretUsage[]> = {};
    const add = (name: string, u: SecretUsage) => (out[name] ??= []).push(u);
    const [wfs, fns, hooks] = await withTenant(ctx, (tx) =>
      Promise.all([
        tx
          .select({
            id: workflows.id,
            name: workflows.name,
            definition: workflowVersions.definition,
          })
          .from(workflows)
          .innerJoin(
            workflowVersions,
            and(
              eq(workflowVersions.workflowId, workflows.id),
              eq(workflowVersions.version, workflows.currentVersion),
            ),
          )
          .where(eq(workflows.workspaceId, ctx.workspaceId)),
        tx
          .selectDistinctOn([functions.name], {
            id: functions.id,
            name: functions.name,
            permissions: functions.permissions,
          })
          .from(functions)
          .where(eq(functions.workspaceId, ctx.workspaceId))
          .orderBy(functions.name, sql`${functions.version} desc`),
        tx
          .select({
            id: webhooks.id,
            name: webhooks.name,
            secretName: webhooks.secretName,
          })
          .from(webhooks)
          .where(eq(webhooks.workspaceId, ctx.workspaceId)),
      ]),
    );
    for (const w of wfs)
      for (const n of secretRefs(w.definition))
        add(n, { type: "workflow", id: w.id, name: w.name });
    for (const f of fns) {
      const p = f.permissions as { secrets?: string[] } | null;
      for (const n of new Set(p?.secrets ?? []))
        add(n, { type: "function", id: f.name, name: f.name });
    }
    for (const h of hooks)
      if (h.secretName)
        add(h.secretName, { type: "webhook", id: h.id, name: h.name });
    const ai = await workspaceAi(ctx);
    if (ai) add(ai.keySecret, { type: "ai", id: ai.preset.id, name: ai.preset.label });
    return out;
  },
};
