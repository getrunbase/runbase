// Trigger blocks: `definition.trigger` of a workflow.
import { Queue } from "bullmq";
import { z } from "zod";
import { queueOptions } from "../bus";
import { filterSchema } from "../filter";
import type { TenantContext } from "../tenant";

const validTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// trigger.event: `eventType` (name from webhooks.create) accepted as an alias
// of `event`.
const eventAlias = (v: unknown) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const t = v as Record<string, unknown>;
    if (
      t.type === "trigger.event" &&
      t.event === undefined &&
      t.eventType !== undefined
    ) {
      const { eventType, ...rest } = t;
      return { ...rest, event: eventType };
    }
  }
  return v;
};

// Trigger variants, also exposed in the blocks catalog (blocks.list).
export const triggerVariants = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trigger.record_created"), object: z.string() }),
  z.object({
    type: z.literal("trigger.record_updated"),
    object: z.string(),
    // Empty or missing: any change triggers.
    fields: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("trigger.event"), event: z.string() }),
  // With `object`: one run per record of the filter; without: a simple run.
  // `timezone` (IANA, e.g. Europe/Paris): cron time zone, default UTC.
  z.object({
    type: z.literal("trigger.schedule"),
    cron: z.string(),
    object: z.string().optional(),
    filter: filterSchema.optional(),
    timezone: z.string().refine(validTimezone, "unknown time zone").optional(),
  }),
  // Incoming webhook (name): each valid reception starts a run. With
  // `object` + `mapping` (field -> path in the payload, e.g.
  // `attendees.0.email`), the record is first created or updated (key
  // `match`, unique field) and the run targets it.
  z.object({
    type: z.literal("trigger.webhook"),
    webhook: z.string().min(1),
    object: z.string().optional(),
    match: z.string().optional(),
    mapping: z.record(z.string(), z.string()).optional(),
  }),
  // Error workflow: started when a run of another workflow fails
  // (`workflow`: id or name to watch only one). Payload in
  // {{event.runId}}, {{event.workflowId}}, {{event.workflowName}},
  // {{event.error}}, {{event.recordId}}.
  z.object({
    type: z.literal("trigger.run_failed"),
    workflow: z.string().optional(),
  }),
  // Workflow object: editor context, optional.
  z.object({
    type: z.literal("trigger.manual"),
    object: z.string().optional(),
  }),
]);

export const triggerSchema = z.preprocess(eventAlias, triggerVariants);
export type Trigger = z.infer<typeof triggerSchema>;

// Cron: one repeatable BullMQ job per active workflow with trigger.schedule.
export const SCHEDULE_QUEUE = "workflow-schedules";
export type ScheduleJob = TenantContext & { workflowId: string };

let queue: Queue<ScheduleJob> | undefined;
export const scheduleQueue = () =>
  (queue ??= new Queue(SCHEDULE_QUEUE, queueOptions()));

export async function syncSchedule(
  ctx: TenantContext,
  wf: { id: string; status: string },
  trigger: Trigger,
) {
  if (wf.status === "active" && trigger.type === "trigger.schedule")
    await scheduleQueue().upsertJobScheduler(
      wf.id,
      {
        pattern: trigger.cron,
        ...(trigger.timezone && { tz: trigger.timezone }),
      },
      { name: "schedule", data: { ...ctx, workflowId: wf.id } },
    );
  else await scheduleQueue().removeJobScheduler(wf.id);
}
