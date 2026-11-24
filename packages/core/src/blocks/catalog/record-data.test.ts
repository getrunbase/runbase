// Integration test: requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Worker } from "bullmq";
import { queueOptions } from "../../bus";
import { objectsService } from "../../objects";
import { recordsService } from "../../records";
import { processStep, runsQueue, runsService, RUNS_QUEUE } from "../../runs";
import type { TenantContext } from "../../tenant";
import { workflowsService } from "../../workflows";

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

test("a workflow writes a field, creates and searches records", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("Data");
  const obj = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "score", label: "Score", type: "number" },
    ],
  });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "Acme" },
  });
  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
  });

  const wf = await workflowsService.create(ctx, {
    name: "Score",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "score",
          type: "record.update",
          input: { recordId: "{{record.id}}", data: { score: 80 } },
        },
        {
          id: "create",
          type: "record.create",
          input: { object: "company", data: { name: "Beta", score: 10 } },
        },
        {
          id: "search",
          type: "record.search",
          input: {
            object: "company",
            filter: { field: "score", op: "gte", value: 50 },
          },
        },
      ],
      next: { score: { ok: ["create"] }, create: { ok: ["search"] } },
    },
  });
  const run = await runsService.start(ctx, wf.id, { recordId: record.id });
  let done;
  for (let i = 0; i < 100; i++) {
    done = await runsService.get(ctx, run!.id);
    if (done!.status !== "running") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await worker.close();
  assert.equal(done!.status, "succeeded", JSON.stringify(done!.steps));

  // Visible in the record page.
  const fiche = await recordsService.get(ctx, record.id);
  assert.equal(fiche.data.score, 80);
  const all = await recordsService.search(ctx, obj.id);
  assert.equal(all.length, 2);
  const found = done!.steps[2]!.output as { records: { id: string }[] };
  assert.equal(done!.steps[2]!.branch, "found");
  assert.deepEqual(
    found.records.map((r) => r.id),
    [record.id],
  );
  const [log] =
    await sql`select count(*)::int as n from audit_log where action = 'record.update' and resource_id = ${record.id}`;
  assert.equal(log!.n, 1);
});
