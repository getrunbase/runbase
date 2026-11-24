// Integration test: generic funnel emission points
// (workflow created, run started), identifiers only. Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { workflowsService } from "../workflows";
import { runsService } from "../runs";
import { registerExtensions, resetExtensions, type TrackProps } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

test("funnel: workflow.created then run.started, no PII", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const [org] = await sql`insert into organizations (name) values ('Funnel') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'W') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'Jane Doe', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx: TenantContext = { organizationId: org!.id, workspaceId: ws!.id, actor: { userId: uid } };

  const events: { event: string; props?: TrackProps }[] = [];
  registerExtensions({ telemetry: { track: (event, props) => void events.push({ event, props }) } });
  try {
    const wf = await workflowsService.create(ctx, {
      name: "Funnel",
      definition: { trigger: { type: "trigger.manual" }, steps: [] },
    });
    const run = await runsService.start(ctx, wf.id, { input: {} });
    assert.deepEqual(
      events.map((e) => e.event),
      ["workflow.created", "run.started"],
    );
    assert.deepEqual(events[0]!.props, {
      organizationId: org!.id,
      workspaceId: ws!.id,
      workflowId: wf.id,
    });
    assert.equal(events[1]!.props!.runId, run!.id);
    const dump = JSON.stringify(events);
    assert.ok(!dump.includes("Jane") && !dump.includes("@x.io"));
  } finally {
    resetExtensions();
  }
});
