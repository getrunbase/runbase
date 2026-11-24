// Acceptance test: an agent creates a workflow, tests it in dry run
// then activates it, entirely through MCP. Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { client, owner } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

test("workflow created, tested in dry run then activated through MCP", async () => {
  const call = client(await owner());

  const blocks = await call("blocks.list");
  const cond = blocks.find((b: { type: string }) => b.type === "condition");
  assert.ok(cond?.inputSchema, "schéma d'input de la brique condition");

  await call("objects.create", {
    slug: "lead",
    name: "Lead",
    fields: [
      { key: "score", label: "Score", type: "number" },
      { key: "stage", label: "Stage", type: "text" },
    ],
  });
  const [hot, cold] = await call("records.upsert_batch", {
    object: "lead",
    items: [{ data: { score: 90 } }, { data: { score: 10 } }],
  });

  const definition = {
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "hot",
        type: "condition",
        input: {
          object: "lead",
          recordId: "{{record.id}}",
          condition: { all: [{ field: "score", op: "gte", value: 50 }] },
        },
      },
      {
        id: "tag",
        type: "record.update",
        input: { recordId: "{{record.id}}", data: { stage: "sales" } },
      },
      {
        id: "nurture",
        type: "record.update",
        input: { recordId: "{{record.id}}", data: { stage: "nurture" } },
      },
    ],
    next: { hot: { true: ["tag"], false: ["nurture"] } },
  };
  assert.deepEqual(await call("workflows.validate", { definition }), {
    errors: [],
    warnings: [],
  });
  const wf = await call("workflows.create", { name: "Qualif", definition });
  assert.equal(wf.status, "draft");

  const dry = await call("workflows.dry_run", {
    definition: (await call("workflows.get", { id: wf.id })).definition,
    records: [hot.record.id, cold.record.id],
  });
  assert.deepEqual(
    dry.map((r: { path: { stepId: string }[] }) => r.path.map((p) => p.stepId)),
    [
      ["hot", "tag"],
      ["hot", "nurture"],
    ],
  );
  assert.equal(dry[0].path[1].simulated, true);
  // Dry run without side effects.
  assert.equal(
    (await call("records.get", { id: hot.record.id })).data.stage,
    undefined,
  );

  assert.equal(
    (await call("workflows.activate", { id: wf.id })).status,
    "active",
  );
  assert.equal((await call("workflows.list"))[0].status, "active");

  const runs = await call("workflows.run_manual", {
    id: wf.id,
    recordIds: [hot.record.id],
  });
  assert.equal(runs.length, 1);
  const { items: listed, nextCursor } = await call("runs.list", {
    workflowId: wf.id,
  });
  assert.equal(nextCursor, null);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].workflowName, "Qualif");
  assert.equal(
    (await call("runs.get", { id: listed[0].id })).workflowId,
    wf.id,
  );

  assert.equal(
    (await call("workflows.deactivate", { id: wf.id })).status,
    "paused",
  );
  assert.equal(
    await call("workflows.delete", { id: wf.id, confirm: true }),
    true,
  );
  assert.equal((await call("workflows.list")).length, 0);
});
