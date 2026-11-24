// Versioned workflows: each change of the definition creates an
// immutable version; restoring copies an old definition into a new version.
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { track } from "../extensions";
import { workflows, workflowVersions } from "../db/schema";
import { isValueMode, validateCondition } from "../blocks/catalog/condition";
import { objectsService } from "../objects";
import { syncSchedule, triggerSchema } from "../triggers/schema";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import { durationSchema } from "../blocks/duration";
import {
  dryRun,
  testStep,
  validateDefinition,
  validateItems,
  type DryRunOptions,
} from "./validate";
import { AppError, type ErrorItem } from "../errors/app-error";
import { isUuid } from "../lib/uuid";
export { normalizeGraph, targetsOf, type Graph } from "./graph";

const node = z.record(z.string(), z.unknown());
// next[step][branch]: list of targets (several = parallel paths);
// entry: steps started by the trigger (missing = the first).
const targets = z.array(z.string());
export const definitionSchema = z.object({
  trigger: node,
  steps: z.array(node),
  next: z.record(z.string(), z.record(z.string(), targets)).optional(),
  entry: z.array(z.string()).optional(),
  // Global run timeout (`2h`, `3d`): beyond that, the run fails.
  timeout: durationSchema.optional(),
  // Concurrency key (A8), template rendered at run start, e.g.
  // `{{record.company_id}}`: at most one active run per key, the next ones
  // wait their turn (creation order). Empty value: no limit.
  concurrencyKey: z.string().optional(),
  // Pinned outputs per step ({ output, branch? }): replayed in dry run and
  // in step tests, ignored by the engine.
  pins: z
    .record(
      z.string(),
      z.object({ output: z.unknown(), branch: z.string().optional() }),
    )
    .optional(),
  // Node positions in the editor; ignored by the engine.
  layout: z
    .record(z.string(), z.object({ x: z.number(), y: z.number() }))
    .optional(),
});
export type Definition = z.infer<typeof definitionSchema>;
// Validation against the object schema: a condition on an unknown
// field or with an incompatible type makes the definition invalid (not saved).
async function validate(ctx: TenantContext, raw: unknown) {
  const definition = definitionSchema.parse(raw);
  triggerSchema.parse(definition.trigger);
  for (const step of definition.steps)
    if (step.type === "condition" && !isValueMode(step.input))
      await validateCondition(() => objectsService.list(ctx), step.input);
  return definition;
}

// Items: `errorItem(...)` (translatable) or raw text (generic code).
export class InvalidWorkflow extends AppError {
  readonly errors: string[];
  constructor(errors: (string | ErrorItem)[]) {
    const items = errors.map((e) =>
      typeof e === "string" ? { code: "error", params: {}, message: e } : e,
    );
    super(
      "workflows.invalid",
      `Invalid workflow: ${items.map((i) => i.message).join(" ; ")}`,
      {},
      { kind: "invalid_workflow", items },
    );
    this.errors = items.map((i) => i.message);
  }
}

export type WorkflowStatus = "draft" | "active" | "paused";

const res = (id: string) => ({ type: "workflow", id });
// Non-uuid id: no workflow (not found) rather than a raw SQL error.
const inWs = (ctx: TenantContext, id: string) =>
  isUuid(id)
    ? and(eq(workflows.id, id), eq(workflows.workspaceId, ctx.workspaceId))
    : sql`false`;

async function load(tx: Tx, ctx: TenantContext, id: string) {
  const [wf] = await tx.select().from(workflows).where(inWs(ctx, id));
  return wf ?? null;
}

// Adds a version and makes it current.
async function addVersion(
  tx: Tx,
  ctx: TenantContext,
  wf: { id: string; currentVersion: number },
  definition: Definition,
) {
  const [last] = await tx
    .select({ version: workflowVersions.version })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, wf.id))
    .orderBy(desc(workflowVersions.version))
    .limit(1);
  const version = (last?.version ?? 0) + 1;
  await tx.insert(workflowVersions).values({
    organizationId: ctx.organizationId,
    workflowId: wf.id,
    version,
    definition,
  });
  return version;
}

async function version(tx: Tx, workflowId: string, v: number) {
  const [row] = await tx
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, workflowId),
        eq(workflowVersions.version, v),
      ),
    );
  return row ?? null;
}

// trigger.schedule cron aligned with the current version and the status.
async function syncTrigger(
  ctx: TenantContext,
  wf: { id: string; status: string; currentVersion: number },
) {
  const v = await withTenant(ctx, (tx) =>
    version(tx, wf.id, wf.currentVersion),
  );
  const trigger = triggerSchema.safeParse(
    (v?.definition as Definition | undefined)?.trigger,
  );
  if (trigger.success) await syncSchedule(ctx, wf, trigger.data);
}

export const workflowsService = {
  // Validation errors (graph, branches, inputs, conditions); [] = valid.
  validate: async (ctx: TenantContext, raw: unknown) => {
    await requireScope(ctx, "read");
    return validateDefinition(ctx, definitionSchema.parse(raw));
  },
  // Same, as translatable items (code + params + English message) for the UI.
  validateItems: async (ctx: TenantContext, raw: unknown) => {
    await requireScope(ctx, "read");
    return validateItems(ctx, definitionSchema.parse(raw));
  },
  // Errors and warnings (unverifiable refs) as items.
  check: async (ctx: TenantContext, raw: unknown) => {
    await requireScope(ctx, "read");
    const warnings: ErrorItem[] = [];
    const errors = await validateItems(
      ctx,
      definitionSchema.parse(raw),
      warnings,
    );
    return { errors, warnings };
  },
  // Execution without side effects on records (or once with an event
  // alone): path, reasons, input and output per step.
  dryRun: async (
    ctx: TenantContext,
    raw: unknown,
    recordIds: string[] = [],
    opts: DryRunOptions = {},
  ) => {
    await requireScope(ctx, "read");
    return dryRun(ctx, definitionSchema.parse(raw), recordIds, opts);
  },
  // A single step with a provided input (otherwise the definition's).
  testStep: async (
    ctx: TenantContext,
    raw: unknown,
    stepId: string,
    opts: Parameters<typeof testStep>[3] = {},
  ) => {
    await requireScope(ctx, opts.live ? "write" : "read");
    return testStep(ctx, definitionSchema.parse(raw), stepId, opts);
  },
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select()
        .from(workflows)
        .where(eq(workflows.workspaceId, ctx.workspaceId))
        .orderBy(workflows.createdAt),
    );
  },
  // Workflow and definition of its current version.
  get: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const wf = await load(tx, ctx, id);
      if (!wf) return null;
      const v = await version(tx, id, wf.currentVersion);
      return { ...wf, definition: v!.definition as Definition };
    });
  },
  versions: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      if (!(await load(tx, ctx, id))) return [];
      return tx
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, id))
        .orderBy(workflowVersions.version);
    });
  },
  create: async (
    ctx: TenantContext,
    input: { name: string; definition: Definition },
  ) => {
    await requireScope(ctx, "write");
    const definition = await validate(ctx, input.definition);
    return withTenant(ctx, async (tx) => {
      // Created as draft: no cron to schedule.
      const [wf] = await tx
        .insert(workflows)
        .values({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          name: input.name,
        })
        .returning();
      await addVersion(tx, ctx, wf!, definition);
      await audit(tx, ctx, "workflow.create", res(wf!.id), input);
      return wf!;
    }).then((wf) => {
      // Product analytics (no-op without extension): identifiers only.
      void track("workflow.created", {
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        workflowId: wf.id,
      });
      return wf;
    });
  },
  // A new definition creates a new version.
  update: async (
    ctx: TenantContext,
    id: string,
    patch: { name?: string; status?: WorkflowStatus; definition?: Definition },
  ) => {
    await requireScope(ctx, "write");
    const definition =
      patch.definition && (await validate(ctx, patch.definition));
    // An invalid workflow cannot be activated.
    if (patch.status === "active") {
      const current =
        definition ?? (await workflowsService.get(ctx, id))?.definition;
      const errors = current ? await validateItems(ctx, current) : [];
      if (errors.length) throw new InvalidWorkflow(errors);
    }
    const row = await withTenant(ctx, async (tx) => {
      const wf = await load(tx, ctx, id);
      if (!wf) return null;
      const currentVersion = definition
        ? await addVersion(tx, ctx, wf, definition)
        : wf.currentVersion;
      const [row] = await tx
        .update(workflows)
        .set({
          ...(patch.name && { name: patch.name }),
          ...(patch.status && { status: patch.status }),
          currentVersion,
          updatedAt: new Date(),
        })
        .where(inWs(ctx, id))
        .returning();
      await audit(tx, ctx, "workflow.update", res(id), patch);
      return row!;
    });
    if (row) await syncTrigger(ctx, row);
    return row;
  },
  activate: (ctx: TenantContext, id: string) =>
    workflowsService.update(ctx, id, { status: "active" }),
  deactivate: (ctx: TenantContext, id: string) =>
    workflowsService.update(ctx, id, { status: "paused" }),
  // Deletes the workflow, its versions and its runs (cascade); removes its cron.
  remove: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "write");
    const row = await withTenant(ctx, async (tx) => {
      const [row] = await tx.delete(workflows).where(inWs(ctx, id)).returning();
      if (row) await audit(tx, ctx, "workflow.delete", res(id));
      return row ?? null;
    });
    if (row)
      await syncSchedule(
        ctx,
        { id, status: "deleted" },
        { type: "trigger.manual" },
      );
    return row !== null;
  },
  // Restore = new version taking the definition of `v` (history kept).
  restore: async (ctx: TenantContext, id: string, v: number) => {
    await requireScope(ctx, "write");
    const row = await withTenant(ctx, async (tx) => {
      const wf = await load(tx, ctx, id);
      const old = wf && (await version(tx, id, v));
      if (!wf || !old) return null;
      const currentVersion = await addVersion(
        tx,
        ctx,
        wf,
        old.definition as Definition,
      );
      const [row] = await tx
        .update(workflows)
        .set({ currentVersion, updatedAt: new Date() })
        .where(inWs(ctx, id))
        .returning();
      await audit(tx, ctx, "workflow.restore", res(id), { version: v });
      return row!;
    });
    if (row) await syncTrigger(ctx, row);
    return row;
  },
};
