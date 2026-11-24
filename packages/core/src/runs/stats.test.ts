// Integration test of runsService.statusCounts: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { runsService } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

test("statusCounts: runs per status in the [from, to[ window", async () => {
  const [o] =
    await sql`insert into organizations (name) values ('S') returning id`;
  const [w] =
    await sql`insert into workspaces (organization_id, name) values (${o!.id}, 'W') returning id`;
  const [f] = await sql`insert into workflows (organization_id, workspace_id, name)
    values (${o!.id}, ${w!.id}, 'F') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'S', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${o!.id}, 'owner')`;
  await sql`insert into workflow_runs (organization_id, workspace_id,
      workflow_id, version, actor, input, status, created_at)
    values
      (${o!.id}, ${w!.id}, ${f!.id}, 1, '{}', '{}', 'succeeded', now() - interval '1 hour'),
      (${o!.id}, ${w!.id}, ${f!.id}, 1, '{}', '{}', 'succeeded', now() - interval '2 hours'),
      (${o!.id}, ${w!.id}, ${f!.id}, 1, '{}', '{}', 'failed', now() - interval '3 hours'),
      (${o!.id}, ${w!.id}, ${f!.id}, 1, '{}', '{}', 'succeeded', now() - interval '30 hours')`;
  const ctx: TenantContext = {
    organizationId: o!.id,
    workspaceId: w!.id,
    actor: { userId: uid },
  } as TenantContext;
  const now = new Date();
  const day = new Date(now.getTime() - 24 * 3600 * 1000);
  const prev = new Date(now.getTime() - 48 * 3600 * 1000);
  assert.deepEqual(await runsService.statusCounts(ctx, day, now), {
    succeeded: 2,
    failed: 1,
  });
  assert.deepEqual(await runsService.statusCounts(ctx, prev, day), {
    succeeded: 1,
  });
});
