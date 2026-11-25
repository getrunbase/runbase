// Resolver: consumes the bus and cron, creates the runs of active
// workflows whose trigger matches.
import { and, eq, inArray, or } from "drizzle-orm";
import { Worker, type Job } from "bullmq";
import { workerConcurrency } from "../runs";
import {
  events,
  objects,
  workflows,
  workflowVersions,
} from "../db/schema";
import { pick } from "../webhooks";
import { BUS_QUEUE, queueOptions, type BusEvent, type BusJob } from "../bus";
import { fairProcessor } from "../queues/fair";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { recordError } from "../errors/record";
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
import { notFound } from "../errors/app-error";

export * from "./schema";

// Beyond that, an event.emit chain (A emits, B reacts, B emits…) is cut.
export const MAX_CHAIN_DEPTH = 5;

// A run already active on the record is not duplicated: the ignored trigger
// is visible in the error center (except `quiet`, counted by the caller).
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
  } = {},
) {
  try {
    return await runsService.start(ctx, workflowId, {
      recordId: o.recordId,
      depth: o.depth,
      event: o.event,
      idempotencyKey: o.key,
      manual: o.manual,
    });
  } catch (e) {
    if (!(e instanceof RunAlreadyActive)) throw e;
    if (!o.quiet)
      await recordError(ctx, {
        source: "workflow",
        message: `Trigger skipped: a run of this workflow is already in progress on this record`,
        payload: { workflowId, recordId: o.recordId, event: o.event },
      });
    return null;
  }
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

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const { id, changed = [], depth = 0, key, ...base } = job.data;
  delete base.fq;
  let ctx: TenantContext = base;
  if (job.name === "record.deleted") return [];
  // Paused workspace: triggers stop (the event or record itself is kept).
  if (await isPaused(ctx.workspaceId)) return [];
  if (job.name === "run.failed") return runFailed(ctx, job.data);
  let objectId: string | undefined;
  let recordId: string | undefined;
  let eventType: string | undefined;
  let ev: typeof events.$inferSelect | undefined;
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
    const match =
      (job.name === "record.created" &&
        t.type === "trigger.record_created" &&
        slugs(t.object)) ||
      (job.name === "record.updated" &&
        t.type === "trigger.record_updated" &&
        (!t.fields?.length || t.fields.some((f) => changed.includes(f))) &&
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
      } catch (e) {
        await recordError(ctx, {
          source: "workflow",
          message: `Webhook ${t.webhook}: mapping failed: ${(e as Error).message}`,
          payload: { workflowId: wfId, eventId: id, payload: ev!.payload },
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
        event: ev && withRecordId(ev.payload, ev.recordId ?? target),
        key: key && `bus:${key}`,
      }),
    );
  }
  return runs.filter(Boolean).map((r) => r!.id);
}

// Event payload enriched with `recordId` (linked record) when it is an object
// without that field.
export function withRecordId(payload: unknown, recordId?: string | null) {
  if (!recordId || !payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload) || "recordId" in payload) return payload;
  return { ...payload, recordId };
}

// Payload -> record: paths mapped to fields, upsert by `match`
// (without key: creation). Missing values ignored.
export function mapPayload(mapping: Record<string, string>, payload: unknown) {
  const data: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(mapping)) {
    const v = pick(payload, path);
    if (v !== undefined && v !== null && v !== "") data[field] = v;
  }
  return data;
}

async function mapWebhook(
  ctx: TenantContext,
  t: Extract<Trigger, { type: "trigger.webhook" }>,
  payload: unknown,
) {
  const object = await objectsService.get(ctx, t.object!);
  if (!object)
    throw notFound("workflows.unknownTriggerObject", "Unknown object {object}", {
      object: String(t.object),
    });
  const { record } = await recordsService.upsert(ctx, {
    objectId: object.id,
    data: mapPayload(t.mapping!, payload),
    match: t.match,
  });
  return record.id;
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
  for (let after: string | undefined; ; ) {
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
  ) => {
    // A manual run is activity: it also resumes a paused workspace.
    await touchActivity(ctx.workspaceId);
    const runs = [];
    for (const recordId of recordIds.length ? recordIds : [undefined])
      runs.push(await start(ctx, workflowId, { recordId, manual: true }));
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
