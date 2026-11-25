// Workspace activity and paused state: activity recorded and throttled,
// crons and triggers skipped while paused, resume on activity.
// Requires DATABASE_URL and REDIS_URL.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import type { Job } from "bullmq";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { runsQueue } from "../runs";
import type { TenantContext } from "../tenant";
import { processSchedule, resolve, triggersService } from "../triggers";
import { workflowsService } from "../workflows";
import {
  inactiveWorkspaces,
  isPaused,
  pauseWorkspace,
  resetActivityThrottle,
  resumeWorkspace,
  touchActivity,
} from "./activity";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));
beforeEach(resetActivityThrottle);

async function owner(name: string): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'main') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, ${name}, ${uid + "@example.com"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

const lastActive = async (id: string) =>
  (await sql`select last_active_at from workspaces where id = ${id}`)[0]!
    .last_active_at as Date | null;

test("setup", () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
});

test("nothing is paused by default and activity is recorded", async () => {
  const ctx = await owner("activity default");
  assert.equal(await isPaused(ctx.workspaceId), false);
  assert.equal(await lastActive(ctx.workspaceId), null);
  assert.equal(await touchActivity(ctx.workspaceId), false);
  const first = await lastActive(ctx.workspaceId);
  assert.ok(first);
  // Throttled: a second touch in the window writes nothing.
  await sql`update workspaces set last_active_at = '2000-01-01' where id = ${ctx.workspaceId}`;
  await touchActivity(ctx.workspaceId);
  assert.equal(
    (await lastActive(ctx.workspaceId))!.toISOString().slice(0, 4),
    "2000",
  );
});

test("inactiveWorkspaces lists only active workspaces idle before the date", async () => {
  const idle = await owner("activity idle");
  const busy = await owner("activity busy");
  await sql`update workspaces set last_active_at = now() - interval '30 days' where id = ${idle.workspaceId}`;
  await touchActivity(busy.workspaceId);
  const before = new Date(Date.now() - 14 * 86_400_000);
  let ids = (await inactiveWorkspaces(before)).map((w) => w.id);
  assert.ok(ids.includes(idle.workspaceId));
  assert.ok(!ids.includes(busy.workspaceId));
  await pauseWorkspace(idle.workspaceId);
  ids = (await inactiveWorkspaces(before)).map((w) => w.id);
  assert.ok(!ids.includes(idle.workspaceId));
});

test("paused workspace: crons and triggers stop, data stays, activity resumes it", async () => {
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("activity paused");
  const obj = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const onCreate = await workflowsService.create(ctx, {
    name: "On create",
    definition: {
      trigger: { type: "trigger.record_created", object: "deal" },
      steps: [],
    },
  });
  await workflowsService.update(ctx, onCreate.id, { status: "active" });
  const cron = await workflowsService.create(ctx, {
    name: "Cron",
    definition: {
      trigger: { type: "trigger.schedule", cron: "0 9 * * *" },
      steps: [],
    },
  });
  await workflowsService.update(ctx, cron.id, { status: "active" });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "Acme" },
  });
  const created = () =>
    resolve({ name: "record.created", data: { ...ctx, id: record.id } });
  const scheduled = () =>
    processSchedule({ data: { ...ctx, workflowId: cron.id } } as Job);

  await pauseWorkspace(ctx.workspaceId);
  assert.equal(await isPaused(ctx.workspaceId), true);
  assert.deepEqual(await created(), []);
  assert.deepEqual(await scheduled(), []);
  // Data and workflows are kept.
  assert.equal((await recordsService.get(ctx, record.id)).id, record.id);
  assert.equal((await workflowsService.get(ctx, cron.id))?.status, "active");

  // Activity resumes the workspace.
  assert.equal(await touchActivity(ctx.workspaceId), true);
  assert.equal(await isPaused(ctx.workspaceId), false);
  assert.equal((await scheduled()).length, 1);

  // A manual run also resumes a paused workspace.
  await pauseWorkspace(ctx.workspaceId);
  resetActivityThrottle();
  const manual = await workflowsService.create(ctx, {
    name: "Manual",
    definition: { trigger: { type: "trigger.manual" }, steps: [] },
  });
  await workflowsService.update(ctx, manual.id, { status: "active" });
  assert.equal((await triggersService.manual(ctx, manual.id, [])).length, 1);
  assert.equal(await isPaused(ctx.workspaceId), false);

  await pauseWorkspace(ctx.workspaceId);
  await resumeWorkspace(ctx.workspaceId);
  assert.equal(await isPaused(ctx.workspaceId), false);
});
