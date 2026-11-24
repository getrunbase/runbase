// Sub-workflows (workflow.run) and error workflow (trigger.run_failed):
// integration, requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Worker, type Job } from "bullmq";
import { busQueue, queueOptions, type BusEvent, type BusJob } from "../bus";
import type { TenantContext } from "../tenant";
import { resolve } from "../triggers";
import { workflowsService } from "../workflows";
import { processStep, runsQueue, runsService, RUNS_QUEUE } from "./index";

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

async function settle(ctx: TenantContext, runId: string) {
  let run;
  for (let i = 0; i < 100; i++) {
    run = await runsService.get(ctx, runId);
    if (!["running", "waiting"].includes(run!.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return run!;
}

test("workflow.run: waiting for the result, without waiting, failure to the error workflow", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  await busQueue().obliterate({ force: true });
  const ctx = await owner("Sub");
  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
    concurrency: 4,
  });
  try {
    await workflowsService.create(ctx, {
      name: "child",
      definition: {
        trigger: { type: "trigger.manual" },
        steps: [
          {
            id: "calc",
            type: "data.set",
            input: { values: { double: "{{event.n}}{{event.n}}" } },
          },
        ],
      },
    });
    const parent = await workflowsService.create(ctx, {
      name: "parent",
      definition: {
        trigger: { type: "trigger.manual" },
        steps: [
          {
            id: "sub",
            type: "workflow.run",
            input: { workflow: "child", event: { n: "4" } },
          },
          {
            id: "after",
            type: "data.set",
            input: {
              values: {
                got: "{{steps.sub.output.output.double}}",
                ids: "{{run.id}}/{{workflow.id}}",
              },
            },
          },
          {
            id: "fire",
            type: "workflow.run",
            input: { workflow: "child", wait: false },
          },
        ],
        next: { sub: { ok: ["after"] }, after: { ok: ["fire"] } },
      },
    });
    const run = await settle(
      ctx,
      (await runsService.start(ctx, parent.id))!.id,
    );
    assert.equal(run.status, "succeeded", JSON.stringify(run.steps));
    const after = run.steps.find((s) => s.stepId === "after")!;
    // Built-in engine variables: run.id, workflow.id.
    assert.deepEqual(after.output, {
      got: "44",
      ids: `${run.id}/${parent.id}`,
    });
    assert.equal(
      (run.steps.find((s) => s.stepId === "fire")!.output as { status: string })
        .status,
      "running",
    );

    // Failure of a sub-workflow: no error branch, the parent fails;
    // the error workflow receives the failed run.
    await workflowsService.create(ctx, {
      name: "casse",
      definition: {
        trigger: { type: "trigger.manual" },
        steps: [{ id: "stop", type: "stop.error", input: { message: "Boom" } }],
      },
    });
    const onError = await workflowsService.create(ctx, {
      name: "alerte",
      definition: {
        trigger: { type: "trigger.run_failed", workflow: "casse" },
        steps: [
          {
            id: "note",
            type: "data.set",
            input: {
              values: { msg: "{{event.workflowName}} : {{event.error}}" },
            },
          },
        ],
      },
    });
    await workflowsService.activate(ctx, onError.id);
    const p2 = await workflowsService.create(ctx, {
      name: "parent2",
      definition: {
        trigger: { type: "trigger.manual" },
        steps: [
          { id: "sub", type: "workflow.run", input: { workflow: "casse" } },
        ],
      },
    });
    const run2 = await settle(ctx, (await runsService.start(ctx, p2.id))!.id);
    assert.equal(run2.status, "failed");
    assert.match(run2.error!, /Sub-workflow failed/);

    // Bus: run.failed of the "casse" sub-workflow (not the parent2 one).
    const jobs = (await busQueue().getJobs(["waiting", "prioritized", "delayed"])) as Job<
      BusJob,
      unknown,
      BusEvent
    >[];
    const failed = jobs.filter((j) => j.name === "run.failed");
    const started = [];
    for (const j of failed) started.push(...(await resolve(j)));
    assert.equal(started.length, 1);
    const alert = await settle(ctx, started[0]!);
    assert.deepEqual(alert.steps[0]!.output, { msg: "casse : Boom" });
  } finally {
    await worker.close();
  }
});

test("workflow.run: bounded depth, unknown workflow reported by validate", async () => {
  const ctx = await owner("SubDepth");
  const { blocks, blockContext } = await import("../blocks");
  const b = blocks["workflow.run"]!;
  await assert.rejects(
    b.run(b.inputSchema.parse({ workflow: "x" }), blockContext(ctx, 5)),
    /Maximum sub-workflow depth/,
  );
  assert.deepEqual(
    await workflowsService.validate(ctx, {
      trigger: { type: "trigger.run_failed", workflow: "absent" },
      steps: [{ id: "s", type: "workflow.run", input: { workflow: "absent" } }],
    }),
    ["trigger.workflow: unknown workflow absent", "s: unknown workflow absent"],
  );
});
