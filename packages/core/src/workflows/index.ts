// Versioned workflows: each change of the definition creates an
// immutable version; restoring copies an old definition into a new version.
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { track } from "../extensions";
import {
  auditLog,
  runSteps,
  workflowRuns,
  workflows,
  workflowVersions,
} from "../db/schema";
import { isValueMode, validateCondition } from "../blocks/catalog/condition";
import { objectsService } from "../objects";
import { syncSchedule, triggerSchema } from "../triggers/schema";
import { checkCronInterval } from "../triggers/cron-interval";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import { durationSchema } from "../blocks/duration";
import {
  coverageOf,
  dryRun,
  testStep,
  unreachedWrites,
  validateDefinition,
  validateItems,
  type DryRunOptions,
} from "./validate";
import {
  AppError,
  appError,
  notFound,
  type ErrorItem,
} from "../errors/app-error";
import { isUuid } from "../lib/uuid";
import { normalizeGraph } from "./graph";
import { errorItem } from "../errors/app-error";
export { normalizeGraph, targetsOf, type Graph } from "./graph";
export { WORKFLOWS_GUIDE } from "./guide";
export { WORKFLOW_EXAMPLES, type WorkflowExample } from "./examples";

const node = z.record(z.string(), z.unknown());
// next[step][branch]: list of targets (several = parallel paths), or a
// single target id; entry: steps started by the trigger (missing = the
// first). Saved definitions always store arrays (see parseDefinition).
const targets = z.union([z.string(), z.array(z.string())]);
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
      z.object({
        output: z.unknown().optional(),
        branch: z.string().optional(),
        // Forces the step to fail with this message (error branches).
        error: z.string().optional(),
      }),
    )
    .optional(),
  // Node positions in the editor; ignored by the engine.
  layout: z
    .record(z.string(), z.object({ x: z.number(), y: z.number() }))
    .optional(),
});
export type Definition = z.infer<typeof definitionSchema>;

// Parses a definition and stores every `next` target list as an array
// (`"b"` and `["b"]` are the same edge).
export function parseDefinition(raw: unknown): Definition {
  const definition = definitionSchema.parse(raw);
  if (!definition.next) return definition;
  return { ...definition, next: normalizeGraph(definition).next };
}
// Validation against the object schema: a condition on an unknown
// field or with an incompatible type makes the definition invalid (not saved).
async function validate(ctx: TenantContext, raw: unknown) {
  const definition = parseDefinition(raw);
  const trigger = triggerSchema.parse(definition.trigger);
  if (trigger.type === "trigger.schedule")
    await checkCronInterval(ctx, trigger.cron, trigger.timezone);
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

// Workflow by id or, failing that, by name (oldest first when names repeat).
async function load(tx: Tx, ctx: TenantContext, ref: string) {
  if (isUuid(ref)) {
    const [wf] = await tx.select().from(workflows).where(inWs(ctx, ref));
    if (wf) return wf;
  }
  const [byName] = await tx
    .select()
    .from(workflows)
    .where(
      and(eq(workflows.workspaceId, ctx.workspaceId), eq(workflows.name, ref)),
    )
    .orderBy(asc(workflows.createdAt))
    .limit(1);
  return byName ?? null;
}

// Id of a workflow given by id or name (null: unknown).
async function resolveId(ctx: TenantContext, ref: string) {
  return (await withTenant(ctx, (tx) => load(tx, ctx, ref)))?.id ?? null;
}

// Stable hash of a definition (key order, editor layout and test-only
// pins ignored): a dry run of a definition marks every version with the
// same hash tested, so a dry run with pins counts for the saved version.
export function definitionHash(definition: Definition) {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
          )
        : v;
  const rest: Partial<Definition> = { ...definition };
  delete rest.layout;
  delete rest.pins;
  if (rest.next) rest.next = normalizeGraph(definition).next;
  return createHash("sha256")
    .update(JSON.stringify(canon(rest)))
    .digest("hex");
}

// Latest version saved after the live one (a staged draft), if any.
async function pendingDraft(
  tx: Tx,
  wf: { id: string; currentVersion: number },
) {
  const [row] = await tx
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, wf.id),
        gt(workflowVersions.version, wf.currentVersion),
      ),
    )
    .orderBy(desc(workflowVersions.version))
    .limit(1);
  return row ?? null;
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

// True when `v` of the workflow passed a clean dry run (audited by
// workflowsService.dryRunWorkflow) or a succeeded test run.
async function isTested(tx: Tx, ctx: TenantContext, id: string, v: number) {
  const row = await version(tx, id, v);
  const hash = row ? definitionHash(row.definition as Definition) : "";
  if (await isHashTested(tx, ctx, id, hash, v)) return true;
  const [run] = await tx
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workflowId, id),
        eq(workflowRuns.version, v),
        eq(workflowRuns.isTest, true),
        eq(workflowRuns.status, "succeeded"),
      ),
    )
    .limit(1);
  return Boolean(run);
}

// A clean dry run of version `v`, or of a definition with this hash.
async function isHashTested(
  tx: Tx,
  ctx: TenantContext,
  id: string,
  hash: string,
  v?: number,
) {
  const [dry] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.workspaceId, ctx.workspaceId),
        eq(auditLog.action, "workflow.dry_run"),
        eq(auditLog.resourceType, "workflow"),
        eq(auditLog.resourceId, id),
        v === undefined
          ? sql`${auditLog.diff}->>'hash' = ${hash}`
          : sql`((${auditLog.diff}->>'version')::int = ${v} or ${auditLog.diff}->>'hash' = ${hash})`,
      ),
    )
    .limit(1);
  return Boolean(dry);
}

// Latest recorded dry-run attempt of a version (or of its hash): its
// blocking reasons, so the untested error names the real blocker.
async function lastAttempt(
  tx: Tx,
  ctx: TenantContext,
  id: string,
  v: number,
): Promise<string[]> {
  const row = await version(tx, id, v);
  const hash = row ? definitionHash(row.definition as Definition) : "";
  const [last] = await tx
    .select({ diff: auditLog.diff })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.workspaceId, ctx.workspaceId),
        eq(auditLog.action, COVERAGE_ACTION),
        eq(auditLog.resourceId, id),
        sql`${auditLog.diff}->>'hash' = ${hash}`,
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  return ((last?.diff as { blocking?: string[] } | null)?.blocking ??
    []) as string[];
}

// Kind `untested`: an expected gate the agent clears itself, not an
// incident (the MCP does not log it in the error center). Names the
// blockers of the last dry run when there was one; a staged draft
// cannot be test-run (runs.start runs the live version), so the
// runs.start route is only offered for the live version.
async function untested(
  ctx: TenantContext,
  wf: { id: string; currentVersion: number },
  v: number,
) {
  const { id } = wf;
  const blocking = await withTenant(ctx, (tx) => lastAttempt(tx, ctx, id, v));
  const meta = { kind: "untested" };
  if (blocking.length)
    return appError(
      "workflows.untestedBlocked",
      'Version {version} of workflow {id} is not tested yet. The last workflows.dry_run was blocked by: {blocking}. Reach those steps with `records` / `events` that take their branch, or pin the branch that leads to them (definition.pins = { "<stepId>": { branch: "<branch>" } }, records: [{ id, pins }] per record); coverage adds up across dry runs of this version. Then workflows.activate { id: "{id}" }.',
      { id, version: v, blocking: blocking.join(" ; ") },
      meta,
    );
  if (v > wf.currentVersion)
    return appError(
      "workflows.untestedDraft",
      'Version {version} (staged draft) of workflow {id} has never been tested. Run workflows.dry_run { workflow: "{id}", version: {version} } with no failing path, then workflows.activate { id: "{id}" } promotes it.',
      { id, version: v },
      meta,
    );
  return appError(
    "workflows.untested",
    'Version {version} of workflow {id} has never been tested. Run workflows.dry_run { workflow: "{id}", version: {version} } with no failing path (or a test run runs.start { id: "{id}", test: true } that succeeds), then workflows.activate { id: "{id}" } promotes it.',
    { id, version: v },
    meta,
  );
}

// Audit action of every dry_run attempt on a saved workflow: steps
// reached (clean attempts only) and blocking reasons. Coverage adds up
// across attempts with the same definition hash.
const COVERAGE_ACTION = "workflow.dry_run_coverage";

// Steps reached by earlier clean dry runs of this hash and by succeeded
// test runs of versions with this hash.
async function priorReached(
  tx: Tx,
  ctx: TenantContext,
  id: string,
  hash: string,
) {
  const reached = new Set<string>();
  const rows = await tx
    .select({ diff: auditLog.diff })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.workspaceId, ctx.workspaceId),
        eq(auditLog.action, COVERAGE_ACTION),
        eq(auditLog.resourceId, id),
        sql`${auditLog.diff}->>'hash' = ${hash}`,
      ),
    );
  for (const r of rows)
    for (const s of (r.diff as { reached?: string[] } | null)?.reached ?? [])
      reached.add(s);
  const versions = (
    await tx
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, id))
  )
    .filter((x) => definitionHash(x.definition as Definition) === hash)
    .map((x) => x.version);
  if (versions.length) {
    const steps = await tx
      .select({ stepId: runSteps.stepId })
      .from(runSteps)
      .innerJoin(workflowRuns, eq(workflowRuns.id, runSteps.runId))
      .where(
        and(
          eq(workflowRuns.workflowId, id),
          eq(workflowRuns.isTest, true),
          eq(workflowRuns.status, "succeeded"),
          inArray(workflowRuns.version, versions),
        ),
      );
    for (const s of steps) reached.add(s.stepId);
  }
  return reached;
}

// Validation result attached to create/update: errors (blocking for
// activation) and warnings (refs that cannot be checked before a run).
async function validationOf(ctx: TenantContext, definition: Definition) {
  const warnings: ErrorItem[] = [];
  const errors = await validateItems(ctx, definition, warnings);
  return {
    errors: errors.map((e) => e.message),
    warnings: warnings.map((e) => e.message),
  };
}

// A dry-run target: a record id, or a record with its own pins (one
// call can then drive each human.approve / switch branch per record).
export type DryRunRecord = string | { id: string; pins?: Definition["pins"] };
export type DryRunManyOptions = DryRunOptions & { events?: unknown[] };

// One dry run per (event, record group): records without pins share a
// group, each record with pins runs with them merged over the
// definition's.
async function dryRunMany(
  ctx: TenantContext,
  definition: Definition,
  records: DryRunRecord[],
  opts: DryRunManyOptions,
) {
  const plain = records.filter((r): r is string => typeof r === "string");
  const pinned = records.filter((r) => typeof r !== "string");
  const groups: { ids: string[]; pins?: Definition["pins"] }[] = [
    ...(plain.length || !pinned.length ? [{ ids: plain }] : []),
    ...pinned.map((r) => ({ ids: [r.id], pins: r.pins })),
  ];
  const { events, ...rest } = opts;
  const out = [];
  for (const event of events?.length ? events : [opts.event])
    for (const g of groups)
      out.push(
        ...(await dryRun(
          ctx,
          g.pins
            ? { ...definition, pins: { ...definition.pins, ...g.pins } }
            : definition,
          g.ids,
          { ...rest, event },
        )),
      );
  return out;
}

export const workflowsService = {
  // Validation errors (graph, branches, inputs, conditions); [] = valid.
  validate: async (ctx: TenantContext, raw: unknown) => {
    await requireScope(ctx, "read");
    return validateDefinition(ctx, parseDefinition(raw));
  },
  // Definition of a stored workflow (id or name): its pending draft when
  // one is staged, otherwise its live version.
  definitionOf: async (ctx: TenantContext, ref: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const wf = await load(tx, ctx, ref);
      if (!wf) return null;
      const v =
        (await pendingDraft(tx, wf)) ??
        (await version(tx, wf.id, wf.currentVersion));
      return v!.definition as Definition;
    });
  },
  // Same, as translatable items (code + params + English message) for the UI.
  validateItems: async (ctx: TenantContext, raw: unknown) => {
    await requireScope(ctx, "read");
    return validateItems(ctx, parseDefinition(raw));
  },
  // Errors and warnings (unverifiable refs) as items.
  check: async (ctx: TenantContext, raw: unknown) => {
    await requireScope(ctx, "read");
    const warnings: ErrorItem[] = [];
    const errors = await validateItems(ctx, parseDefinition(raw), warnings);
    return { errors, warnings };
  },
  // Execution without side effects on records (or once with an event
  // alone): path, reasons, input and output per step.
  // `records` entries may carry their own pins; `events`: one run per
  // event.
  dryRun: async (
    ctx: TenantContext,
    raw: unknown,
    recordIds: DryRunRecord[] = [],
    opts: DryRunManyOptions = {},
  ) => {
    await requireScope(ctx, "read");
    return dryRunMany(ctx, parseDefinition(raw), recordIds, opts);
  },
  // A single step with a provided input (otherwise the definition's).
  // `raw` = a definition, or `{ workflow }` (id or name): its staged draft,
  // else its live version.
  testStep: async (
    ctx: TenantContext,
    raw: unknown,
    stepId: string,
    opts: Parameters<typeof testStep>[3] = {},
  ) => {
    await requireScope(ctx, opts.live ? "write" : "read");
    const ref = (raw as { workflow?: unknown } | null)?.workflow;
    if (typeof ref === "string" && !(raw as { steps?: unknown }).steps) {
      const definition = await workflowsService.definitionOf(ctx, ref);
      if (!definition)
        throw notFound("workflows.notFound", "Workflow {id} not found", {
          id: ref,
        });
      return testStep(ctx, definition, stepId, opts);
    }
    return testStep(ctx, parseDefinition(raw), stepId, opts);
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
  // `draftVersion`: a staged version saved after the live one, waiting
  // for a test before activation promotes it.
  get: async (ctx: TenantContext, ref: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const wf = await load(tx, ctx, ref);
      if (!wf) return null;
      const v = await version(tx, wf.id, wf.currentVersion);
      const draft = await pendingDraft(tx, wf);
      return {
        ...wf,
        definition: v!.definition as Definition,
        ...(draft && { draftVersion: draft.version }),
      };
    });
  },
  versions: async (ctx: TenantContext, ref: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      const wf = await load(tx, ctx, ref);
      if (!wf) return [];
      return tx
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, wf.id))
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
    }).then(async (wf) => {
      // Product analytics (no-op without extension): identifiers only.
      void track("workflow.created", {
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        workflowId: wf.id,
      });
      return { ...wf, ...(await validationOf(ctx, definition)) };
    });
  },
  // A new definition creates a new version.
  update: async (
    ctx: TenantContext,
    ref: string,
    patch: { name?: string; status?: WorkflowStatus; definition?: Definition },
  ) => {
    await requireScope(ctx, "write");
    const id = (await resolveId(ctx, ref)) ?? ref;
    const definition =
      patch.definition && (await validate(ctx, patch.definition));
    // An invalid workflow cannot be activated; its remaining warnings are
    // returned with the activated workflow.
    const activationWarnings: ErrorItem[] = [];
    if (patch.status === "active") {
      const current =
        definition ?? (await workflowsService.get(ctx, id))?.definition;
      const errors = current
        ? await validateItems(ctx, current, activationWarnings)
        : [];
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
    if (!row) return null;
    await syncTrigger(ctx, row);
    if (definition) return { ...row, ...(await validationOf(ctx, definition)) };
    return patch.status === "active"
      ? { ...row, warnings: activationWarnings.map((e) => e.message) }
      : row;
  },
  // Agent (MCP) update with the test gate. A workflow that is or becomes
  // active only runs tested versions: a new untested definition for an
  // active workflow is staged as a draft (vN+1) while vN stays live;
  // workflows.dry_run { workflow, version } then activate promotes it.
  // A definition whose hash passed a dry run is saved live directly.
  updateTested: async (
    ctx: TenantContext,
    ref: string,
    patch: { name?: string; status?: WorkflowStatus; definition?: Definition },
  ) => {
    await requireScope(ctx, "write");
    const wf = await withTenant(ctx, (tx) => load(tx, ctx, ref));
    if (!wf) return null;
    const id = wf.id;
    const staysActive =
      patch.status === "active" ||
      (patch.status === undefined && wf.status === "active");
    if (patch.definition) {
      const definition = await validate(ctx, patch.definition);
      const hashTested = await withTenant(ctx, (tx) =>
        isHashTested(tx, ctx, id, definitionHash(definition)),
      );
      if (!staysActive || hashTested)
        return workflowsService.update(ctx, id, { ...patch, definition });
      if (wf.status !== "active") {
        // Not live: save it, then refuse the activation.
        const saved = await workflowsService.update(ctx, id, {
          name: patch.name,
          definition,
        });
        throw await untested(ctx, saved!, saved!.currentVersion);
      }
      // Live: stage the draft, the live version keeps running.
      const draftVersion = await withTenant(ctx, async (tx) => {
        const v = await addVersion(tx, ctx, wf, definition);
        if (patch.name)
          await tx
            .update(workflows)
            .set({ name: patch.name, updatedAt: new Date() })
            .where(inWs(ctx, id));
        await audit(tx, ctx, "workflow.stage", res(id), {
          version: v,
          name: patch.name,
        });
        return v;
      });
      return {
        ...(await workflowsService.get(ctx, id))!,
        draftVersion,
        staged: true,
        ...(await validationOf(ctx, definition)),
        next: `Version ${draftVersion} is staged as a draft; version ${wf.currentVersion} stays live. Run workflows.dry_run { workflow: "${id}", version: ${draftVersion} } with no failing path, then workflows.activate { id: "${id}" } to promote it.`,
      };
    }
    if (patch.status !== "active")
      return workflowsService.update(ctx, id, patch);
    const draft = await withTenant(ctx, (tx) => pendingDraft(tx, wf));
    // Already active, nothing staged: nothing new goes live.
    if (!draft && wf.status === "active")
      return workflowsService.update(ctx, id, patch);
    const target = draft?.version ?? wf.currentVersion;
    // Blocking validation errors (missing connection, secret...) first:
    // testing cannot clear them, so reporting `untested` would mislead.
    const targetDef = draft
      ? (draft.definition as Definition)
      : (await workflowsService.get(ctx, id))?.definition;
    if (targetDef) {
      const invalid = await validateItems(ctx, targetDef);
      if (invalid.length) throw new InvalidWorkflow(invalid);
    }
    if (!(await withTenant(ctx, (tx) => isTested(tx, ctx, id, target))))
      throw await untested(ctx, wf, target);
    if (!draft) return workflowsService.update(ctx, id, patch);
    // Promote the tested draft and activate in one transaction.
    const warnings: ErrorItem[] = [];
    const errors = await validateItems(
      ctx,
      draft.definition as Definition,
      warnings,
    );
    if (errors.length) throw new InvalidWorkflow(errors);
    const row = await withTenant(ctx, async (tx) => {
      const [row] = await tx
        .update(workflows)
        .set({
          ...(patch.name && { name: patch.name }),
          status: "active",
          currentVersion: draft.version,
          updatedAt: new Date(),
        })
        .where(inWs(ctx, id))
        .returning();
      await audit(tx, ctx, "workflow.promote", res(id), {
        version: draft.version,
      });
      return row!;
    });
    await syncTrigger(ctx, row);
    return {
      ...row,
      promoted: draft.version,
      warnings: warnings.map((e) => e.message),
    };
  },
  activate: (ctx: TenantContext, id: string) =>
    workflowsService.update(ctx, id, { status: "active" }),
  // Dry run of the current version of a saved workflow. A run without any
  // failing path marks that version as tested (audit `workflow.dry_run`).
  // Target: `version`, else `definition` (tested by hash: a later update
  // with the same definition goes live directly), else the staged draft,
  // else the live version.
  dryRunWorkflow: async (
    ctx: TenantContext,
    ref: string,
    recordIds: DryRunRecord[] = [],
    opts: DryRunManyOptions & {
      version?: number;
      definition?: Definition;
    } = {},
  ) => {
    await requireScope(ctx, "read");
    const found = await withTenant(ctx, async (tx) => {
      const wf = await load(tx, ctx, ref);
      if (!wf) return null;
      const v = opts.version
        ? await version(tx, wf.id, opts.version)
        : opts.definition
          ? null
          : ((await pendingDraft(tx, wf)) ??
            (await version(tx, wf.id, wf.currentVersion)));
      return { wf, v };
    });
    if (!found) return null;
    const { wf } = found;
    if (opts.version && !found.v)
      throw notFound(
        "workflows.versionNotFound",
        "Version {version} of workflow {id} does not exist. See workflows.versions.",
        { version: opts.version, id: wf.id },
      );
    const definition = opts.definition
      ? parseDefinition(opts.definition)
      : (found.v!.definition as Definition);
    const v = found.v?.version ?? null;
    const results = await dryRunMany(ctx, definition, recordIds, {
      ...opts,
      workflowId: wf.id,
    });
    // Failures of this attempt: validation errors (activation would
    // refuse it anyway), a failing or skipped run.
    const failures = [
      ...(await validateItems(ctx, definition)).map((e) => e.message),
      ...results.flatMap((r) => [
        ...(r.error ? [r.error] : []),
        ...(r.skipped ? [r.skipped] : []),
      ]),
    ];
    const clean = failures.length === 0;
    const blocking = [...failures];
    const hash = definitionHash(definition);
    const steps = definition.steps as { id: string; type: string }[];
    // Coverage adds up across the clean dry runs and succeeded test runs
    // of this definition hash: one call per branch is enough.
    const reachedNow = new Set(
      clean ? results.flatMap((r) => r.path.map((s) => s.stepId)) : [],
    );
    const prior = await withTenant(ctx, (tx) =>
      priorReached(tx, ctx, wf.id, hash),
    );
    const reached = new Set([...prior, ...reachedNow]);
    const coverage = coverageOf(steps, [
      [...reached].map((stepId) => ({ stepId })),
    ]);
    // Every run stopped at its first condition and no earlier attempt
    // went further: nothing behind the filter was exercised.
    const stopped = results.filter((r) => r.untested);
    const priorAdds = [...prior].some((id) => !reachedNow.has(id));
    if (stopped.length === results.length && stopped.length && !priorAdds)
      blocking.push(...new Set(stopped.map((r) => r.untested!)));
    // A write or send no run reached was never exercised: not a test.
    const writes = await unreachedWrites(
      ctx,
      steps,
      normalizeGraph(definition).next,
      coverage.unreached,
    );
    if (writes.length && !results.every((r) => r.skipped))
      blocking.push(
        errorItem(
          "workflows.dryRunUnreachedWrites",
          "No dry run reached the side-effect steps {steps}: pass `records` (or `event`) that take their branch, or pin the branch that leads to them",
          { steps: writes.join(", ") },
        ).message,
      );
    const tested = blocking.length === 0;
    await withTenant(ctx, async (tx) => {
      await audit(tx, ctx, COVERAGE_ACTION, res(wf.id), {
        ...(v !== null && { version: v }),
        hash,
        reached: [...reachedNow],
        blocking,
      });
      if (tested)
        await audit(tx, ctx, "workflow.dry_run", res(wf.id), {
          ...(v !== null && { version: v }),
          hash,
        });
    });
    const live = v === wf.currentVersion;
    return {
      version: v,
      liveVersion: wf.currentVersion,
      tested,
      ...(!tested && { blocking }),
      // Steps reached across every attempt on this definition hash.
      coverage,
      unreachedWrites: writes,
      ...(tested &&
        !live && {
          next:
            v === null
              ? `Definition tested: workflows.update { id: "${wf.id}", definition } with this same definition goes live directly.`
              : `Version ${v} tested: workflows.activate { id: "${wf.id}" } promotes it.`,
        }),
      results,
    };
  },
  // Throws `workflows.untested` unless the current version (or the new
  // definition, which would be a new untested version) passed a test.
  requireTested: async (
    ctx: TenantContext,
    ref: string,
    opts: { newDefinition?: boolean } = {},
  ) => {
    await requireScope(ctx, "read");
    const wf = await withTenant(ctx, (tx) => load(tx, ctx, ref));
    if (!wf) return;
    if (opts.newDefinition)
      throw await untested(ctx, wf, wf.currentVersion + 1);
    const ok = await withTenant(ctx, (tx) =>
      isTested(tx, ctx, wf.id, wf.currentVersion),
    );
    if (!ok) throw await untested(ctx, wf, wf.currentVersion);
  },
  // Activation gate for AI agents (MCP): validation plus a passed test;
  // promotes a tested staged draft.
  activateTested: (ctx: TenantContext, ref: string) =>
    workflowsService.updateTested(ctx, ref, { status: "active" }),
  deactivate: (ctx: TenantContext, id: string) =>
    workflowsService.update(ctx, id, { status: "paused" }),
  // Deletes the workflow, its versions and its runs (cascade); removes its cron.
  remove: async (ctx: TenantContext, ref: string) => {
    await requireScope(ctx, "write");
    const id = (await resolveId(ctx, ref)) ?? ref;
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
  restore: async (ctx: TenantContext, ref: string, v: number) => {
    await requireScope(ctx, "write");
    const id = (await resolveId(ctx, ref)) ?? ref;
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
