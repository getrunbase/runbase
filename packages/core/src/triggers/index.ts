// Resolver: consumes the bus and cron, creates the runs of active
// workflows whose trigger matches.
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { ZodError } from "zod";
import { Worker, type Job } from "bullmq";
import { workerConcurrency } from "../runs";
import {
  events,
  objects,
  workflowRuns,
  workflows,
  workflowVersions,
} from "../db/schema";
import { pick } from "../webhooks";
import {
  BUS_QUEUE,
  busQueue,
  queueOptions,
  type BusEvent,
  type BusJob,
} from "../bus";
import { fairProcessor } from "../queues/fair";
import { objectsService } from "../objects";
import { fieldsSchema, valueProblem } from "../objects/fields";
import { recordsService } from "../records";
import { recordError, resolveFanOutErrors } from "../errors/record";
import { RunAlreadyActive, runsService } from "../runs";
import { withTenant, type TenantContext } from "../tenant";
import { workflowsService } from "../workflows";
import { isPaused, touchActivity } from "../workspaces/activity";
import {
  SCHEDULE_QUEUE,
  triggerSchema,
  type ScheduleJob,
  type Trigger,
} from "./schema";
import { appError, notFound } from "../errors/app-error";

export * from "./schema";

// Beyond that, an event.emit chain (A emits, B reacts, B emits…) is cut.
export const MAX_CHAIN_DEPTH = 5;

// Follow-ups of a trigger that hit an active run: retried every
// FOLLOWUP_DELAY_MS, at most MAX_FOLLOWUPS times, then reported.
export const FOLLOWUP_DELAY_MS = 30_000;
export const MAX_FOLLOWUPS = 20;

// Bus job that met a run already active on its record.
type Origin = { name: BusEvent; data: BusJob };

// A run already active on the record is not duplicated. Self-trigger (the
// active run made the write itself): skipped quietly. External write, event
// or webhook: one follow-up per workflow and record is queued, replayed once
// the active run ends (see `followUp`). Without an origin (cron, manual), the
// ignored trigger is visible in the error center (except `quiet`).
// `key`: idempotency key (bus replay without a duplicate run).
async function start(
  ctx: TenantContext,
  workflowId: string,
  o: {
    recordId?: string;
    depth?: number;
    event?: unknown;
    key?: string;
    quiet?: boolean;
    manual?: boolean;
    test?: boolean;
    origin?: Origin;
    // Trigger `queue: "each"`: one follow-up per delivery, no coalescing.
    each?: boolean;
  } = {},
) {
  try {
    return await runsService.start(ctx, workflowId, {
      recordId: o.recordId,
      depth: o.depth,
      event: o.event,
      idempotencyKey: o.key,
      manual: o.manual,
      test: o.test,
    });
  } catch (e) {
    if (!(e instanceof RunAlreadyActive)) throw e;
    if (o.origin && o.recordId) {
      if (await isSelfTrigger(ctx, workflowId, o.recordId, o.origin))
        return null;
      if (await followUp(ctx, workflowId, o.recordId, o.origin, o.each))
        return null;
    }
    if (!o.quiet)
      await recordError(ctx, {
        source: "workflow",
        message: o.origin
          ? `Trigger dropped: a run of this workflow stayed in progress on this record after ${MAX_FOLLOWUPS} follow-up attempts`
          : `Trigger skipped: a run of this workflow is already in progress on this record`,
        payload: { workflowId, recordId: o.recordId, event: o.event },
      });
    return null;
  }
}

// Record write made by the active run itself (same actor, record event):
// re-triggering would loop, the run already sees its own write.
async function isSelfTrigger(
  ctx: TenantContext,
  workflowId: string,
  recordId: string,
  origin: Origin,
) {
  if (origin.name !== "record.created" && origin.name !== "record.updated")
    return false;
  const [run] = await withTenant(ctx, (tx) =>
    tx
      .select({ actor: workflowRuns.actor })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workflowId, workflowId),
          eq(workflowRuns.recordId, recordId),
          isNull(workflowRuns.finishedAt),
        ),
      ),
  );
  return (
    !!run && JSON.stringify(run.actor) === JSON.stringify(origin.data.actor)
  );
}

// Delayed replay of the origin job, restricted to this workflow. Job id per
// workflow, record and attempt: several triggers during one run coalesce into
// one follow-up that replays the latest one (its data replaces the queued
// job's), and `coalesced` keeps the ids of every trigger folded into it.
// false when the attempts are exhausted.
async function followUp(
  ctx: TenantContext,
  workflowId: string,
  recordId: string,
  origin: Origin,
  each = false,
) {
  const n = (origin.data.followups ?? 0) + 1;
  if (n > MAX_FOLLOWUPS) return false;
  const data: FollowUpJob = { ...origin.data };
  delete data.fq;
  // `each`: the trigger id makes the job unique, nothing is coalesced.
  const jobId =
    `followup-${ctx.workspaceId}-${workflowId}-${recordId}-${n}` +
    (each ? `-${data.id}` : "");
  const queued = await busQueue().getJob(jobId);
  const prev = (queued?.data as FollowUpJob | undefined)?.coalesced ?? [];
  const next: FollowUpJob = {
    ...data,
    only: workflowId,
    followups: n,
    key: undefined,
    coalesced: [...new Set([...prev, ...(data.coalesced ?? []), data.id])],
  };
  if (queued && (await queued.isDelayed())) {
    const old = (queued.data as FollowUpJob).id;
    await queued.updateData(next);
    // The replaced trigger will not be replayed itself: said loudly.
    if (old && old !== data.id) await supersede(ctx, workflowId, old, data.id);
    return true;
  }
  await busQueue().add(origin.name, next, {
    delay: FOLLOWUP_DELAY_MS,
    jobId,
    removeOnComplete: true,
    removeOnFail: 100,
  });
  return true;
}

// Trigger folded into a later one (coalescing): its event is marked
// `superseded` (payload `_runbase.supersededBy`, visible in events.list) and
// a warning goes to the error center. Ids that are not events (record
// triggers) only get the warning.
export async function supersede(
  ctx: TenantContext,
  workflowId: string,
  id: string,
  by: string,
) {
  const [ev] = await withTenant(ctx, (tx) =>
    tx
      .select({ payload: events.payload, isTest: events.isTest })
      .from(events)
      .where(eq(events.id, id)),
  ).catch(() => []);
  if (ev)
    await withTenant(ctx, (tx) =>
      tx
        .update(events)
        .set({ payload: supersededPayload(ev.payload, workflowId, by) })
        .where(eq(events.id, id)),
    );
  await recordError(ctx, {
    source: "workflow",
    message: `Trigger superseded: ${id} was coalesced into ${by} while a run of this workflow was active (set queue: "each" on the trigger to run every delivery)`,
    payload: {
      kind: "superseded",
      workflowId,
      supersededId: id,
      supersededBy: by,
      ...(ev?.isTest && { test: true }),
    },
  });
}

// Event payload with the superseded marker (meta key, original fields kept).
export function supersededPayload(
  payload: Record<string, unknown>,
  workflowId: string,
  by: string,
) {
  const meta = (payload._runbase ?? {}) as Record<string, unknown>;
  return {
    ...payload,
    _runbase: { ...meta, status: "superseded", supersededBy: by, workflowId },
  };
}

// Follow-up job data: ids (events or records) of the triggers it coalesces.
type FollowUpJob = BusJob & { coalesced?: string[] };

export type PendingFollowUp = {
  status: "pending";
  workflowId: string;
  recordId: string | null;
  // Trigger that the follow-up replays (the latest one received).
  replays: string;
  // Every trigger coalesced into this follow-up, oldest first.
  coalesced: string[];
  attempt: number;
  runAt: Date;
};

// Follow-ups waiting for an active run to end (one run plus one follow-up
// per workflow and record), shown as pending runs.
export async function pendingFollowUps(
  ctx: TenantContext,
  filter: { workflowId?: string; recordId?: string } = {},
): Promise<PendingFollowUp[]> {
  const prefix = `followup-${ctx.workspaceId}-`;
  const out: PendingFollowUp[] = [];
  for (const job of await busQueue().getDelayed()) {
    if (!job.id?.startsWith(prefix)) continue;
    const d = job.data as FollowUpJob;
    if (d.workspaceId !== ctx.workspaceId || !d.only) continue;
    const recordId = job.id
      .slice(prefix.length + d.only.length + 1)
      .replace(/-\d+$/, "");
    if (filter.workflowId && filter.workflowId !== d.only) continue;
    if (filter.recordId && filter.recordId !== recordId) continue;
    out.push({
      status: "pending",
      workflowId: d.only,
      recordId: recordId || null,
      replays: d.id,
      coalesced: d.coalesced ?? [d.id],
      attempt: d.followups ?? 1,
      runAt: new Date(job.timestamp + (job.opts.delay ?? 0)),
    });
  }
  return out;
}

// Synchronous check at webhook reception: for each active trigger.webhook of
// this hook with a mapping, `missing` lists the items whose match field does
// not resolve (the upsert would create a duplicate), `warnings` the other
// unresolved paths.
export async function checkWebhookMapping(
  ctx: TenantContext,
  hookName: string,
  items: unknown[],
) {
  const missing: {
    workflowId: string;
    field: string;
    path: string | null;
    item: number;
  }[] = [];
  const invalid: {
    workflowId: string;
    field: string;
    value: unknown;
    problem: string;
    item: number;
  }[] = [];
  const warnings: string[] = [];
  for (const { id, trigger: t } of await activeTriggers(ctx)) {
    if (t.type !== "trigger.webhook" || t.webhook !== hookName) continue;
    if (!t.object || !t.mapping) continue;
    const object = await objectsService.get(ctx, t.object).catch(() => null);
    const fields = object ? fieldsSchema.parse(object.fields) : [];
    for (const [i, item] of items.entries()) {
      const data = mapPayload(t.mapping, item);
      const at = items.length > 1 ? ` (item ${i})` : "";
      for (const p of mappedValueProblems(fields, data))
        invalid.push({ workflowId: id, ...p, item: i });
      if (t.match && empty(data[t.match])) {
        missing.push({
          workflowId: id,
          field: t.match,
          path: t.mapping[t.match] ?? null,
          item: i,
        });
        continue;
      }
      for (const [field, path] of Object.entries(t.mapping))
        if (empty(data[field]))
          warnings.push(
            `path ${path} resolved to nothing (field ${field})${at}`,
          );
    }
  }
  return { missing, invalid, warnings };
}

// Mapped values the record write would refuse: unknown field, invalid
// email, unknown select option, wrong type...
export function mappedValueProblems(
  fields: { key: string }[],
  data: Record<string, unknown>,
) {
  if (!fields.length) return [];
  const out: { field: string; value: unknown; problem: string }[] = [];
  for (const [field, value] of Object.entries(data)) {
    const f = (fields as Parameters<typeof valueProblem>[0][]).find(
      (x) => x.key === field,
    );
    const problem = f ? valueProblem(f, value) : "unknown field";
    if (problem) out.push({ field, value, problem });
  }
  return out;
}

// Active workflows and current definition, in one query (no more
// get per workflow).
async function activeTriggers(ctx: TenantContext) {
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({ id: workflows.id, definition: workflowVersions.definition })
      .from(workflows)
      .innerJoin(
        workflowVersions,
        and(
          eq(workflowVersions.workflowId, workflows.id),
          eq(workflowVersions.version, workflows.currentVersion),
        ),
      )
      .where(
        and(
          eq(workflows.workspaceId, ctx.workspaceId),
          eq(workflows.status, "active"),
        ),
      )
      .orderBy(workflows.createdAt),
  );
  const out: { id: string; trigger: Trigger }[] = [];
  for (const r of rows) {
    const t = triggerSchema.safeParse(
      (r.definition as { trigger?: unknown } | null)?.trigger,
    );
    if (t.success) out.push({ id: r.id, trigger: t.data });
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Object references of triggers (slug or uuid) -> id, in one query.
async function objectIdsOf(ctx: TenantContext, refs: string[]) {
  const map = new Map<string, string>();
  if (!refs.length) return map;
  const ids = refs.filter((r) => UUID.test(r));
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({ id: objects.id, slug: objects.slug })
      .from(objects)
      .where(
        and(
          eq(objects.workspaceId, ctx.workspaceId),
          or(
            inArray(objects.slug, refs),
            ids.length ? inArray(objects.id, ids) : undefined,
          ),
        ),
      ),
  );
  for (const o of rows) {
    map.set(o.slug, o.id);
    map.set(o.id, o.id);
  }
  return map;
}

// Failed run: starts the active workflows with trigger.run_failed (except
// themselves: an error workflow that fails does not restart itself).
async function runFailed(ctx: TenantContext, job: BusJob) {
  const failed = await runsService.get(ctx, job.id);
  if (!failed) return [];
  const wf = await workflowsService.get(ctx, failed.workflowId);
  const isErrorWorkflow =
    triggerSchema.safeParse(wf?.definition.trigger).data?.type ===
    "trigger.run_failed";
  if (!wf || isErrorWorkflow) return [];
  const depth = job.depth ?? 0;
  const runs = [];
  for (const { id: wfId, trigger: t } of await activeTriggers(ctx)) {
    if (t.type !== "trigger.run_failed") continue;
    if (t.workflow && t.workflow !== wf.id && t.workflow !== wf.name) continue;
    if (depth > MAX_CHAIN_DEPTH) continue;
    runs.push(
      await start(ctx, wfId, {
        depth,
        event: {
          runId: failed.id,
          workflowId: wf.id,
          workflowName: wf.name,
          error: failed.error,
          recordId: failed.recordId,
        },
        key: job.key && `bus:${job.key}`,
      }),
    );
  }
  return runs.filter(Boolean).map((r) => r!.id);
}

export async function resolve(job: { name: BusEvent; data: BusJob }) {
  const { id, changed = [], depth = 0, key, only, ...base } = job.data;
  delete base.fq;
  delete base.followups;
  // Workflow whose run made this record write: its own record triggers skip it.
  const via = base.viaWorkflow;
  delete base.viaWorkflow;
  let ctx: TenantContext = base;
  if (job.name === "record.deleted") return [];
  // Paused workspace: triggers stop (the event or record itself is kept).
  if (await isPaused(ctx.workspaceId)) return [];
  if (job.name === "run.failed") return runFailed(ctx, job.data);
  let objectId: string | undefined;
  let recordId: string | undefined;
  let eventType: string | undefined;
  let ev: typeof events.$inferSelect | undefined;
  let data: Record<string, unknown> = {};
  if (job.name === "event.received") {
    [ev] = await withTenant(ctx, (tx) =>
      tx.select().from(events).where(eq(events.id, id)),
    );
    eventType = ev?.type;
    recordId = ev?.recordId ?? undefined;
    // Test event: the runs it triggers are test runs (A4).
    if (ev?.isTest) ctx = { ...ctx, test: true };
  } else {
    const r = await recordsService.get(ctx, id);
    objectId = r.objectId;
    recordId = id;
    data = (r.data ?? {}) as Record<string, unknown>;
    if (r.isTest) ctx = { ...ctx, test: true };
  }
  // Batch preload: triggers and referenced objects, constant number
  // of queries whatever the number of workflows.
  const triggers = await activeTriggers(ctx);
  const ids = await objectIdsOf(
    ctx,
    objectId
      ? [
          ...new Set(
            triggers.flatMap(({ trigger: t }) =>
              t.type === "trigger.record_created" ||
              t.type === "trigger.record_updated"
                ? [t.object]
                : [],
            ),
          ),
        ]
      : [],
  );
  const slugs = (slug: string) => ids.get(slug) === objectId;
  const runs = [];
  for (const { id: wfId, trigger: t } of triggers) {
    // Follow-up or error retry: only the targeted workflow.
    if (only && wfId !== only) continue;
    // Record write made by a run of this workflow: re-triggering would loop.
    if (via === wfId && job.name !== "event.received") continue;
    const match =
      (job.name === "record.created" &&
        t.type === "trigger.record_created" &&
        slugs(t.object)) ||
      (job.name === "record.updated" &&
        t.type === "trigger.record_updated" &&
        (!t.fields?.length || t.fields.some((f) => changed.includes(f))) &&
        changedTo(t.to, changed, data) &&
        slugs(t.object)) ||
      (t.type === "trigger.event" && t.event === eventType) ||
      (t.type === "trigger.webhook" && ev?.source === `webhook:${t.webhook}`);
    if (!match) continue;
    if (depth > MAX_CHAIN_DEPTH) {
      await recordError(ctx, {
        source: "workflow",
        message: `event.emit loop: depth ${depth} > ${MAX_CHAIN_DEPTH}, run not created`,
        payload: { workflowId: wfId, eventId: id, eventType, depth },
      });
      continue;
    }
    let target = recordId;
    if (t.type === "trigger.webhook" && t.object && t.mapping) {
      try {
        target = await mapWebhook(ctx, t, ev!.payload);
        // The event now points to the record it created or updated.
        if (!ev!.recordId) {
          await withTenant(ctx, (tx) =>
            tx
              .update(events)
              .set({ recordId: target })
              .where(and(eq(events.id, ev!.id), isNull(events.recordId))),
          );
          ev = { ...ev!, recordId: target! };
        }
        // Mapping works again (resend or retry): earlier failures are closed,
        // a later resend is deduplicated as usual.
        await resolveFanOutErrors(ctx, id, wfId);
      } catch (e) {
        // Retryable from the error center (errors.retry): `eventId` +
        // `workflowId` replay this fan-out once the mapping is fixed.
        await recordError(ctx, {
          source: "workflow",
          message: `Webhook ${t.webhook}: mapping failed: ${errorText(e)}`,
          payload: {
            kind: "trigger",
            workflowId: wfId,
            eventId: id,
            payload: ev!.payload,
            // Test delivery (x-runbase-test): deleted by workspace.purge_test.
            ...(ev!.isTest && { test: true }),
          },
        });
        continue;
      }
    }
    runs.push(
      await start(ctx, wfId, {
        recordId: target,
        depth,
        // {{event.recordId}} (A10): record linked to the event, unless the payload
        // already carries that field.
        event: ev && withEventMeta(ev, ev.recordId ?? target),
        key: key && `bus:${key}`,
        origin: job,
        each: queueEach(t),
      }),
    );
  }
  return runs.filter(Boolean).map((r) => r!.id);
}

// Follow-up mode of a trigger: webhooks keep every delivery unless
// `queue: "latest"`, other triggers coalesce unless `queue: "each"`.
export function queueEach(t: Trigger) {
  const queue = (t as { queue?: string }).queue;
  return t.type === "trigger.webhook" ? queue !== "latest" : queue === "each";
}

// `to` filter of trigger.record_updated: each field changed in this write
// and now holds the expected value. No filter: true.
export function changedTo(
  to: Record<string, unknown> | undefined,
  changed: string[],
  data: Record<string, unknown>,
) {
  if (!to) return true;
  return Object.entries(to).every(
    ([f, v]) =>
      changed.includes(f) && JSON.stringify(data[f]) === JSON.stringify(v),
  );
}

// Event payload enriched with `recordId` (linked record) when it is an object
// without that field.
export function withRecordId(payload: unknown, recordId?: string | null) {
  if (!recordId || !payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload) || "recordId" in payload) return payload;
  return { ...payload, recordId };
}

// {{event.…}} context: payload plus `recordId`, `id`, `type` and
// `occurredAt` of the stored event, without overwriting payload fields.
export function withEventMeta(
  ev: { id: string; type: string; occurredAt: Date; payload: unknown },
  recordId?: string | null,
) {
  const p = withRecordId(ev.payload, recordId);
  if (!p || typeof p !== "object" || Array.isArray(p)) return p;
  const meta = {
    id: ev.id,
    type: ev.type,
    occurredAt: ev.occurredAt.toISOString(),
  };
  return { ...meta, ...p };
}

// Error text for the error center: Zod issues as `field: message` lines.
export function errorText(e: unknown) {
  if (e instanceof ZodError)
    return e.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
  return e instanceof Error ? e.message : String(e);
}

const empty = (v: unknown) => v === undefined || v === null || v === "";

// Value of a mapping path. The `{{event.…}}` habit makes agents write
// `payload.x` while paths are relative to the payload: when the literal path
// resolves to nothing, the leading `payload.` is stripped (deprecated form,
// write `x`). A payload that really has a `payload` key keeps working.
export function pickMapped(payload: unknown, path: string) {
  const v = pick(payload, path);
  if (!empty(v) || !path.startsWith("payload.")) return v;
  return pick(payload, path.slice("payload.".length));
}

// Payload -> record: paths mapped to fields, upsert by `match`
// (without key: creation). Missing values ignored.
export function mapPayload(mapping: Record<string, string>, payload: unknown) {
  const data: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(mapping)) {
    const v = pickMapped(payload, path);
    if (!empty(v)) data[field] = v;
  }
  return data;
}

// Mapping that cannot produce a usable record: the match key is missing
// (the upsert would create a duplicate on every call) or nothing resolved.
export function mappingProblem(
  mapping: Record<string, string>,
  match: string | undefined,
  data: Record<string, unknown>,
) {
  if (match && empty(data[match]))
    return mapping[match]
      ? `path ${mapping[match]} resolved to nothing (match field ${match})`
      : `match field ${match} is not mapped`;
  if (!Object.keys(data).length)
    return Object.values(mapping)
      .map((p) => `path ${p} resolved to nothing`)
      .join("\n");
  return null;
}

async function mapWebhook(
  ctx: TenantContext,
  t: Extract<Trigger, { type: "trigger.webhook" }>,
  payload: unknown,
) {
  const object = await objectsService.get(ctx, t.object!);
  if (!object)
    throw notFound(
      "workflows.unknownTriggerObject",
      "Unknown object {object}",
      {
        object: String(t.object),
      },
    );
  const data = mapPayload(t.mapping!, payload);
  const problem = mappingProblem(t.mapping!, t.match, data);
  if (problem)
    throw appError(
      "triggers.mappingEmpty",
      "No usable value in the payload: {problem}",
      { problem },
    );
  const { record } = await recordsService.upsert(ctx, {
    objectId: object.id,
    data,
    match: t.match,
  });
  return record.id;
}

// Error retry (errors.retry): replays the fan-out of one event to one
// workflow. true when a run was started.
export async function retryTrigger(
  ctx: TenantContext,
  eventId: string,
  workflowId: string,
) {
  const runs = await resolve({
    name: "event.received",
    data: { ...ctx, id: eventId, only: workflowId },
  });
  return runs.length > 0;
}

// Cron: one run per record matching the filter, or a simple run without an object.
export async function processSchedule(job: Job<ScheduleJob>) {
  const { workflowId, ...ctx } = job.data;
  // Paused workspace: crons stop until the next activity.
  if (await isPaused(ctx.workspaceId)) return [];
  const wf = await workflowsService.get(ctx, workflowId);
  const t = triggerSchema.safeParse(wf?.definition.trigger);
  if (!wf || wf.status !== "active" || t.data?.type !== "trigger.schedule")
    return [];
  if (!t.data.object) {
    const run = await start(ctx, workflowId, {
      key: job.id && `cron:${job.id}`,
    });
    return run ? [run.id] : [];
  }
  const object = await objectsService.get(ctx, t.data.object);
  if (!object) return [];
  const runs = [];
  // Keyset scan by pages of 500.
  for (let after: string | undefined; ;) {
    const page = await recordsService.search(ctx, object.id, {
      filter: t.data.filter,
      pagination: { limit: 500, after },
    });
    after = page.at(-1)?.id;
    for (const r of page)
      runs.push(
        await start(ctx, workflowId, {
          recordId: r.id,
          key: job.id && `cron:${job.id}:${r.id}`,
          quiet: true,
        }),
      );
    if (page.length < 500) break;
  }
  // Records whose previous run is still running: one error per pass.
  const skipped = runs.filter((r) => !r).length;
  if (skipped)
    await recordError(ctx, {
      source: "workflow",
      message: `Schedule: ${skipped} record(s) skipped, a run of this workflow is already in progress on them`,
      payload: { workflowId, skipped },
    });
  return runs.filter(Boolean).map((r) => r!.id);
}

export const triggersService = {
  // trigger.manual: from the UI or MCP, on a record or a selection.
  manual: async (
    ctx: TenantContext,
    workflowId: string,
    recordIds: string[],
    opts: { test?: boolean } = {},
  ) => {
    // A manual run is activity: it also resumes a paused workspace.
    await touchActivity(ctx.workspaceId);
    const runs = [];
    for (const recordId of recordIds.length ? recordIds : [undefined])
      runs.push(
        await start(ctx, workflowId, {
          recordId,
          manual: true,
          ...(opts.test && { test: true }),
        }),
      );
    return runs.filter(Boolean);
  },
};

export const startTriggerWorkers = () => [
  // Bus: concurrency capped per workspace.
  new Worker<BusJob, string[], BusEvent>(BUS_QUEUE, fairProcessor(resolve), {
    ...queueOptions(),
    concurrency: workerConcurrency(),
  }),
  // Cron: one job per workflow and per due date, already bounded; the runs it
  // creates go through the fair runs queue.
  new Worker<ScheduleJob>(SCHEDULE_QUEUE, processSchedule, {
    ...queueOptions(),
    concurrency: workerConcurrency(),
  }),
];
