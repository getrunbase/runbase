// Integration test: requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import type { Job } from "bullmq";
import { busQueue } from "../bus";
import { eventsService } from "../events";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { processStep, runsQueue } from "../runs";
import type { TenantContext } from "../tenant";
import { workflowsService } from "../workflows";
import {
  MAX_CHAIN_DEPTH,
  processSchedule,
  resolve,
  scheduleQueue,
  triggersService,
} from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function owner(name: string): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, ${name}, ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

// Run finished immediately: frees the record for the next trigger.
const steps: never[] = [];

test("record_updated filtered on `onboarding`, schedule and manual", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("Triggers");
  const obj = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "onboarding", label: "Onboarding", type: "text" },
    ],
  });
  const wf = await workflowsService.create(ctx, {
    name: "Onboarding",
    definition: {
      trigger: {
        type: "trigger.record_updated",
        object: "company",
        fields: ["onboarding"],
      },
      steps,
    },
  });
  await workflowsService.update(ctx, wf.id, { status: "active" });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "Acme", onboarding: "todo" },
  });
  const updated = (changed: string[]) =>
    resolve({
      name: "record.updated",
      data: { ...ctx, id: record.id, changed },
    });

  assert.equal((await updated(["onboarding"])).length, 1);
  assert.equal((await updated(["name"])).length, 0);
  assert.equal(
    (
      await resolve({
        name: "record.created",
        data: { ...ctx, id: record.id, changed: ["name"] },
      })
    ).length,
    0,
  );
  // Paused workflow: no longer triggered.
  await workflowsService.update(ctx, wf.id, { status: "paused" });
  assert.equal((await updated(["onboarding"])).length, 0);

  // Invalid definition refused.
  await assert.rejects(
    workflowsService.create(ctx, {
      name: "x",
      definition: { trigger: { type: "nope" }, steps },
    }),
  );

  // Schedule: cron registered, one run per record of the filter.
  await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "Beta", onboarding: "done" },
  });
  const cron = await workflowsService.create(ctx, {
    name: "Cron",
    definition: {
      trigger: {
        type: "trigger.schedule",
        cron: "0 9 * * *",
        object: "company",
        filter: { field: "onboarding", op: "eq", value: "todo" },
      },
      steps,
    },
  });
  await workflowsService.update(ctx, cron.id, { status: "active" });
  assert.ok(await scheduleQueue().getJobScheduler(cron.id));
  const runs = await processSchedule({
    data: { ...ctx, workflowId: cron.id },
  } as Job);
  assert.equal(runs.length, 1);
  await workflowsService.update(ctx, cron.id, { status: "paused" });
  assert.equal(await scheduleQueue().getJobScheduler(cron.id), undefined);

  // Without object: a simple run; time zone passed to the scheduler.
  const simple = await workflowsService.create(ctx, {
    name: "Cron simple",
    definition: {
      trigger: {
        type: "trigger.schedule",
        cron: "0 9 * * 1",
        timezone: "Europe/Paris",
      },
      steps,
    },
  });
  await workflowsService.update(ctx, simple.id, { status: "active" });
  assert.equal(
    (await scheduleQueue().getJobScheduler(simple.id))?.tz,
    "Europe/Paris",
  );
  const one = await processSchedule({
    id: "j1",
    data: { ...ctx, workflowId: simple.id },
  } as Job);
  assert.equal(one.length, 1);
  await workflowsService.update(ctx, simple.id, { status: "paused" });
  assert.match(
    (
      await workflowsService.validate(ctx, {
        trigger: {
          type: "trigger.schedule",
          cron: "* * * * *",
          timezone: "Mars/Olympus",
        },
        steps,
      })
    ).join(),
    /unknown time zone/,
  );

  // Manual: one run per record of the selection.
  const all = await recordsService.search(ctx, obj.id);
  assert.equal(
    (
      await triggersService.manual(
        ctx,
        wf.id,
        all.map((r) => r.id),
      )
    ).length,
    2,
  );
});

test("event.emit loop A ↔ B cut at the maximum depth", async () => {
  // Paused queues: no outside worker (dev, container) consumes the
  // jobs; the test dequeues them itself, real payloads included.
  const bus = busQueue();
  const runs = runsQueue();
  await Promise.all([
    bus.obliterate({ force: true }),
    runs.obliterate({ force: true }),
  ]);
  await Promise.all([bus.pause(), runs.pause()]);
  try {
    const ctx = await owner("Loop");
    for (const [name, on, emit] of [
      ["A", "ping", "pong"],
      ["B", "pong", "ping"],
    ] as const) {
      const wf = await workflowsService.create(ctx, {
        name,
        definition: {
          trigger: { type: "trigger.event", event: on },
          steps: [{ id: "emit", type: "event.emit", input: { type: emit } }],
        },
      });
      await workflowsService.update(ctx, wf.id, { status: "active" });
    }
    await eventsService.insert(ctx, { type: "ping" });

    for (let i = 0; i < 100; i++) {
      const busJobs = await bus.getJobs(["waiting", "prioritized"]);
      const runJobs = await runs.getJobs(["waiting", "prioritized"]);
      if (!busJobs.length && !runJobs.length) break;
      for (const j of busJobs) {
        await resolve(j);
        await j.remove();
      }
      for (const j of runJobs) {
        await processStep(j);
        await j.remove();
      }
    }

    const [c] = await sql`select
      (select count(*)::int from workflow_runs where workspace_id = ${ctx.workspaceId}) as runs,
      (select count(*)::int from errors where workspace_id = ${ctx.workspaceId}) as errors`;
    // Depths 0 to 5: 6 runs, then the chain is cut.
    assert.deepEqual(c, { runs: MAX_CHAIN_DEPTH + 1, errors: 1 });
    const [err] =
      await sql`select message, payload from errors where workspace_id = ${ctx.workspaceId}`;
    assert.match(err!.message as string, /event\.emit loop/);
    assert.equal(
      (err!.payload as { depth: number }).depth,
      MAX_CHAIN_DEPTH + 1,
    );
  } finally {
    await Promise.all([bus.resume(), runs.resume()]);
  }
});

test("trigger.webhook: payload -> record mapping (match), run with event", async () => {
  const { createHmac } = await import("node:crypto");
  const { secretsService } = await import("../secrets");
  const { receiveWebhook, webhooksService } = await import("../webhooks");
  const ctx = await owner("WebhookTrigger");
  await objectsService.create(ctx, {
    slug: "contact",
    name: "Contact",
    fields: [
      { key: "email", label: "Email", type: "email", unique: true },
      { key: "name", label: "Name", type: "text" },
    ],
  });
  await secretsService.set(ctx, "CAL", "k");
  const hook = await webhooksService.create(ctx, {
    name: "calcom",
    eventType: "cal.booking",
    secretName: "CAL",
    config: {
      format: "hmac",
      header: "x-cal-signature-256",
      idPath: "uid",
    } as never,
  });
  const trigger = {
    type: "trigger.webhook",
    webhook: "calcom",
    object: "contact",
    match: "email",
    mapping: {
      email: "payload.attendees.0.email",
      name: "payload.attendees.0.name",
    },
  };
  assert.deepEqual(
    await workflowsService.validate(ctx, {
      trigger: {
        ...trigger,
        webhook: "x",
        match: "name",
        mapping: { zz: "a" },
      },
      steps,
    }),
    [
      "trigger.webhook: unknown webhook x",
      "trigger.mapping: unknown field zz",
      "trigger.match: name must be a unique field",
    ],
  );
  const wf = await workflowsService.create(ctx, {
    name: "Cal",
    definition: { trigger, steps },
  });
  await workflowsService.update(ctx, wf.id, { status: "active" });
  const send = async (uid: string, name: string) => {
    const body = JSON.stringify({
      uid,
      payload: { attendees: [{ email: "Ann@x.io", name }] },
    });
    const sig = createHmac("sha256", "k").update(body).digest("hex");
    const r = await receiveWebhook(hook.id, body, {
      "x-cal-signature-256": sig,
    });
    const id = (r.body as { event_id: string }).event_id;
    return resolve({ name: "event.received", data: { ...ctx, id } } as never);
  };
  const [run1] = await send("b1", "Ann");
  await send("b2", "Ann Lee");
  const c = await objectsService.get(ctx, "contact");
  const all = await recordsService.search(ctx, c!.id);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.data.name, "Ann Lee");
  const [run] =
    await sql`select record_id, input from workflow_runs where id = ${run1!}`;
  assert.equal(run!.record_id, all[0]!.id);
  assert.equal(run!.input.event.uid, "b1");
  const [h] = (await webhooksService.list(ctx)) as {
    sample: { uid: string };
  }[];
  assert.equal(h!.sample.uid, "b2");
});
