// Integration test: requires DATABASE_URL and REDIS_URL.
// Webhook acceptance (sync mapping check, test header) and follow-up
// coalescing visibility.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import postgres from "postgres";
import { busQueue } from "../bus";
import { eventsService } from "../events";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { secretsService } from "../secrets";
import type { TenantContext } from "../tenant";
import { receiveWebhook, webhooksService } from "../webhooks";
import { workflowsService } from "../workflows";
import {
  checkWebhookMapping,
  pendingFollowUps,
  resolve,
  withEventMeta,
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

test("withEventMeta: id, type and occurredAt added, payload fields win", () => {
  const at = new Date("2026-01-01T00:00:00Z");
  const ev = { id: "e1", type: "t", occurredAt: at, payload: { type: "own" } };
  assert.deepEqual(withEventMeta(ev, "r1"), {
    id: "e1",
    type: "own",
    occurredAt: at.toISOString(),
    recordId: "r1",
  });
  assert.deepEqual(withEventMeta({ ...ev, payload: [1] }), [1]);
});

test("trigger.webhook reception: 422 on unresolved match field, warnings otherwise, test header marks event, record and run", async () => {
  const ctx = await owner("WebhookCheck");
  await objectsService.create(ctx, {
    slug: "lead",
    name: "Lead",
    fields: [
      { key: "email", label: "Email", type: "email", unique: true },
      { key: "city", label: "City", type: "text" },
    ],
  });
  await secretsService.set(ctx, "H", "k");
  const hook = await webhooksService.create(ctx, {
    name: "forms",
    eventType: "form.sent",
    secretName: "H",
    config: { format: "hmac", header: "x-sig", idPath: "uid" } as never,
  });
  assert.equal(
    (hook.config as { rejectUnmapped?: boolean }).rejectUnmapped,
    true,
  );
  const wf = await workflowsService.create(ctx, {
    name: "Forms",
    definition: {
      trigger: {
        type: "trigger.webhook",
        webhook: "forms",
        object: "lead",
        match: "email",
        mapping: { email: "email", city: "address.city" },
      },
      steps: [{ id: "w", type: "wait", input: { duration: "1h" } }],
    },
  });
  await workflowsService.update(ctx, wf.id, { status: "active" });
  const send = (p: unknown, h: Record<string, string> = {}) => {
    const body = JSON.stringify(p);
    return receiveWebhook(
      hook.id,
      body,
      { "x-sig": createHmac("sha256", "k").update(body).digest("hex"), ...h },
      { check: checkWebhookMapping },
    );
  };
  const events = () =>
    sql`select id, is_test from events where workspace_id = ${ctx.workspaceId}`;

  const bad = await send({ uid: "e1", mail: "a@x.io" });
  assert.equal(bad.status, 422);
  const missing = (bad.body as { missing: { field: string; path: string }[] })
    .missing;
  assert.equal(missing[0]!.field, "email");
  assert.equal(missing[0]!.path, "email");
  assert.equal((await events()).length, 0);

  const ok = await send(
    { uid: "e2", email: "a@x.io" },
    { "x-runbase-test": "1" },
  );
  assert.equal(ok.status, 200);
  const body = ok.body as {
    event_id: string;
    warnings: string[];
    test: boolean;
  };
  assert.equal(body.test, true);
  assert.match(body.warnings[0]!, /address\.city resolved to nothing/);
  const [ev] = await events();
  assert.equal(ev!.is_test, true);
  const [runId] = await resolve({
    name: "event.received",
    data: { ...ctx, id: body.event_id },
  });
  const [run] =
    await sql`select is_test, record_id, input from workflow_runs where id = ${runId!}`;
  assert.equal(run!.is_test, true);
  assert.equal(run!.input.event.type, "form.sent");
  assert.equal(run!.input.event.id, body.event_id);
  assert.ok(run!.input.event.occurredAt);
  const [rec] =
    await sql`select is_test from records where id = ${run!.record_id}`;
  assert.equal(rec!.is_test, true);

  // rejectUnmapped: false keeps accepting, with a warning.
  await webhooksService.update(ctx, hook.id, {
    config: {
      format: "hmac",
      header: "x-sig",
      idPath: "uid",
      rejectUnmapped: false,
    } as never,
  });
  const soft = await send({ uid: "e3", mail: "b@x.io" });
  assert.equal(soft.status, 200);
  assert.match(
    (soft.body as { warnings: string[] }).warnings[0]!,
    /match field email/,
  );
});

test("follow-up coalesces triggers during an active run and replays the latest one", async () => {
  await busQueue().obliterate({ force: true });
  const ctx = await owner("Coalesce");
  const obj = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "stage", label: "Stage", type: "text" }],
  });
  const wf = await workflowsService.create(ctx, {
    name: "Long",
    definition: {
      trigger: { type: "trigger.event", event: "deal.ping" },
      steps: [{ id: "w", type: "wait", input: { duration: "1h" } }],
    },
  });
  await workflowsService.update(ctx, wf.id, { status: "active" });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { stage: "new" },
  });
  const push = async (n: number) => {
    const ev = await eventsService.insert(ctx, {
      type: "deal.ping",
      recordId: record.id,
      payload: { n },
    });
    return {
      id: ev.id,
      runs: await resolve({
        name: "event.received",
        data: { ...ctx, id: ev.id },
      }),
    };
  };
  assert.equal((await push(1)).runs.length, 1);
  const second = await push(2);
  const third = await push(3);
  assert.deepEqual(third.runs, []);
  const delayed = (await busQueue().getDelayed()).filter((j) =>
    j.id?.startsWith(`followup-${ctx.workspaceId}`),
  );
  assert.equal(delayed.length, 1);
  assert.equal(delayed[0]!.data.id, third.id);
  const pending = await pendingFollowUps(ctx, { workflowId: wf.id });
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.status, "pending");
  assert.equal(pending[0]!.recordId, record.id);
  assert.equal(pending[0]!.replays, third.id);
  assert.deepEqual(pending[0]!.coalesced, [second.id, third.id]);
  // The replaced trigger is marked superseded and a warning is recorded.
  const [sup] = await sql`select payload from events where id = ${second.id}`;
  assert.equal(sup!.payload._runbase.status, "superseded");
  assert.equal(sup!.payload._runbase.supersededBy, third.id);
  assert.equal(sup!.payload.n, 2);
  const warns =
    await sql`select message from errors where workspace_id = ${ctx.workspaceId} and payload->>'kind' = 'superseded'`;
  assert.equal(warns.length, 1);
  assert.match(warns[0]!.message, /queue: "each"/);
  await busQueue().obliterate({ force: true });
});

test("trigger queue: each keeps one follow-up per delivery", async () => {
  await busQueue().obliterate({ force: true });
  const ctx = await owner("QueueEach");
  const obj = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "stage", label: "Stage", type: "text" }],
  });
  const wf = await workflowsService.create(ctx, {
    name: "Each",
    definition: {
      trigger: { type: "trigger.event", event: "deal.each", queue: "each" },
      steps: [{ id: "w", type: "wait", input: { duration: "1h" } }],
    },
  });
  await workflowsService.update(ctx, wf.id, { status: "active" });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { stage: "new" },
  });
  for (const n of [1, 2, 3]) {
    const ev = await eventsService.insert(ctx, {
      type: "deal.each",
      recordId: record.id,
      payload: { n },
    });
    await resolve({ name: "event.received", data: { ...ctx, id: ev.id } });
  }
  const delayed = (await busQueue().getDelayed()).filter((j) =>
    j.id?.startsWith(`followup-${ctx.workspaceId}`),
  );
  assert.equal(delayed.length, 2);
  const warns =
    await sql`select id from errors where workspace_id = ${ctx.workspaceId} and payload->>'kind' = 'superseded'`;
  assert.equal(warns.length, 0);
  await busQueue().obliterate({ force: true });
});

test("trigger.webhook reception: 422 on a mapped value the object refuses, warning otherwise", async () => {
  const ctx = await owner("WebhookValues");
  await objectsService.create(ctx, {
    slug: "lead",
    name: "Lead",
    fields: [
      { key: "email", label: "Email", type: "email", unique: true },
      { key: "plan", label: "Plan", type: "select", options: ["free", "pro"] },
    ],
  });
  await secretsService.set(ctx, "H", "k");
  const hook = await webhooksService.create(ctx, {
    name: "signup",
    eventType: "signup.sent",
    secretName: "H",
    config: { format: "hmac", header: "x-sig", idPath: "uid" } as never,
  });
  const wf = await workflowsService.create(ctx, {
    name: "Signup",
    definition: {
      trigger: {
        type: "trigger.webhook",
        webhook: "signup",
        object: "lead",
        match: "email",
        mapping: { email: "email", plan: "plan" },
      },
      steps: [{ id: "w", type: "wait", input: { duration: "1h" } }],
    },
  });
  await workflowsService.update(ctx, wf.id, { status: "active" });
  const send = (p: unknown) => {
    const body = JSON.stringify(p);
    return receiveWebhook(
      hook.id,
      body,
      { "x-sig": createHmac("sha256", "k").update(body).digest("hex") },
      { check: checkWebhookMapping },
    );
  };
  const bad = await send({ uid: "v1", email: "a@x.io", plan: "gold" });
  assert.equal(bad.status, 422);
  const invalid = (bad.body as { invalid: { field: string; value: unknown }[] })
    .invalid;
  assert.equal(invalid[0]!.field, "plan");
  assert.equal(invalid[0]!.value, "gold");
  const badMail = await send({ uid: "v2", email: "not-an-email" });
  assert.equal(badMail.status, 422);
  assert.equal(
    (await sql`select id from events where workspace_id = ${ctx.workspaceId}`)
      .length,
    0,
  );
  await webhooksService.update(ctx, hook.id, {
    config: {
      format: "hmac",
      header: "x-sig",
      idPath: "uid",
      rejectUnmapped: false,
    } as never,
  });
  const soft = await send({ uid: "v3", email: "b@x.io", plan: "gold" });
  assert.equal(soft.status, 200);
  assert.match(
    (soft.body as { warnings: string[] }).warnings[0]!,
    /field plan: value "gold" rejected/,
  );
});
