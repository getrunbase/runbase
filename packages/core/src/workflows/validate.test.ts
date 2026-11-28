// Validation + dry run: requires DATABASE_URL. Mocked Anthropic API.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { secretsService } from "../secrets";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { workflowsService as wf, InvalidWorkflow } from "./index";
import { z } from "zod";
import { blocks, defineBlock } from "../blocks";

const outbound: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  outbound.push(String(url));
  if (!String(url).startsWith("https://api.anthropic.com/v1/messages"))
    throw new Error(`Appel externe forbidden : ${url}`);
  const body = JSON.parse(String(init.body)) as { system?: string };
  const branch = body.system?.includes("gmail.com") ? "nurture" : "sales";
  return new Response(
    JSON.stringify({
      content: [
        {
          type: "tool_use",
          id: "t",
          name: "decide",
          input: { branch, reason: `domain → ${branch}`, confidence: 0.9 },
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 1 },
    }),
  );
}) as typeof fetch;
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => {
  globalThis.fetch = realFetch;
  setImmediate(() => process.exit(0));
});

test("validate, activation refused, dry run without side effects", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const [org] =
    await sql`insert into organizations (name) values ('Dry') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name, settings) values (${org!.id}, 'Default', '{}') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'D', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  const obj = await objectsService.create(ctx, {
    slug: "lead",
    name: "Lead",
    fields: [
      { key: "email", label: "Email", type: "text" },
      { key: "stage", label: "Stage", type: "text" },
    ],
  });

  const definition = {
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "known",
        type: "condition",
        input: {
          object: "lead",
          recordId: "{{record.id}}",
          condition: { field: "email", op: "contains", value: "@" },
        },
      },
      {
        id: "qualify",
        type: "ai.decide",
        input: {
          prompt: "Qualified?",
          context: "{{record.data}}",
          branches: ["sales", "nurture"],
          ai: { provider: "anthropic", secret: "ANTHROPIC_API_KEY" },
        },
      },
      {
        id: "mark",
        type: "record.update",
        input: { recordId: "{{record.id}}", data: { stage: "sales" } },
      },
      {
        id: "mail",
        type: "record.update",
        input: { recordId: "{{record.id}}", data: { stage: "nurture" } },
      },
      { id: "ping", type: "http.request", input: { url: "https://x.io" } },
    ],
    next: {
      known: { true: ["qualify"], false: ["ping"] },
      qualify: { sales: ["mark"], nurture: ["mail"] },
    },
  };
  // ai.* step: the key secret of input.ai must exist.
  assert.deepEqual(await wf.validate(ctx, definition), [
    "Missing secret ANTHROPIC_API_KEY",
  ]);
  // Customer key: never a platform key.
  await secretsService.set(ctx, "ANTHROPIC_API_KEY", "cle-test");
  assert.deepEqual(await wf.validate(ctx, definition), []);

  // Empty No branch: end of the workflow, valid definition.
  assert.deepEqual(
    await wf.validate(ctx, {
      trigger: { type: "trigger.manual", object: "lead" },
      steps: [definition.steps[0]!, definition.steps.at(-1)!],
      next: { known: { true: ["ping"] } },
      layout: { known: { x: 10, y: 20 } },
    }),
    [],
  );

  // Errors: orphan, invalid input, condition.
  const errors = await wf.validate(ctx, {
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "c",
        type: "condition",
        input: {
          object: "lead",
          recordId: "{{record.id}}",
          condition: { field: "nope", op: "eq", value: 1 },
        },
      },
      { id: "w", type: "wait", input: { duration: "tomorrow" } },
      { id: "lost", type: "wait", input: { duration: "1s" } },
    ],
    next: { c: { true: ["w"] } },
  });
  for (const e of ["lost: step not connected", "w.duration", "c: "])
    assert.ok(
      errors.some((x) => x.startsWith(e)),
      `${e} absent de ${errors}`,
    );

  // An invalid workflow cannot be activated.
  const bad = await wf.create(ctx, {
    name: "KO",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [{ id: "w", type: "wait", input: {} }],
    },
  });
  await assert.rejects(
    wf.update(ctx, bad.id, { status: "active" }),
    InvalidWorkflow,
  );
  const ok = await wf.create(ctx, { name: "OK", definition });
  assert.equal(
    (await wf.update(ctx, ok.id, { status: "active" }))!.status,
    "active",
  );

  // Dry run on 10 records: nothing is sent or written.
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const { record } = await recordsService.upsert(ctx, {
      objectId: obj.id,
      data: {
        email: i % 2 ? `u${i}@gmail.com` : `ceo${i}@acme.io`,
        stage: "new",
      },
    });
    ids.push(record.id);
  }
  const count = async () => {
    const [r] = await sql`select
      (select count(*) from audit_log where workspace_id = ${ws!.id}) as audit,
      (select count(*) from workflow_runs where workspace_id = ${ws!.id}) as runs,
      (select count(*) from events where workspace_id = ${ws!.id}) as events,
      (select max(updated_at) from records where workspace_id = ${ws!.id}) as updated`;
    return r;
  };
  const before = await count();
  // By default, AI is simulated: no outgoing call.
  outbound.length = 0;
  const simulatedAi = await wf.dryRun(ctx, definition, ids.slice(0, 1));
  assert.equal(outbound.length, 0);
  assert.equal(simulatedAi[0]!.path[1]!.simulated, true);
  const results = await wf.dryRun(ctx, definition, ids, { ai: true });
  assert.deepEqual(await count(), before);
  assert.ok(
    outbound.every((u) => u.startsWith("https://api.anthropic.com/v1/messages")),
  );
  assert.equal(outbound.length, 10); // ai.decide actually executed
  for (const id of ids)
    assert.equal((await recordsService.get(ctx, id)).data.stage, "new");

  assert.equal(results.length, 10);
  for (const [i, r] of results.entries()) {
    assert.equal(r.error, undefined);
    const branch = i % 2 ? "nurture" : "sales";
    assert.deepEqual(
      r.path.map((s) => [s.stepId, s.branch, s.simulated]),
      [
        ["known", "true", false],
        ["qualify", branch, false],
        [branch === "sales" ? "mark" : "mail", "ok", true],
      ],
    );
    assert.equal(r.path[1]!.reason, `domain → ${branch}`);
  }

  // Side-effect block outside the catalog: never executed in dry run,
  // its simulation provides the branch.
  let ran = 0;
  blocks["test.effect"] = defineBlock({
    type: "test.effect",
    label: "test.effect",
    description: "",
    sideEffect: true,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    branches: ["ok", "ko"],
    simulate: () => ({ branch: "ko", output: {} }),
    run: async () => {
      ran++;
      return { branch: "ok", output: {} };
    },
  });
  const [effect] = await wf.dryRun(
    ctx,
    {
      trigger: { type: "trigger.manual" },
      steps: [{ id: "e", type: "test.effect" }],
    },
    [ids[0]!],
  );
  assert.equal(ran, 0);
  assert.deepEqual(
    effect!.path.map((s) => [s.stepId, s.branch, s.simulated]),
    [["e", "ko", true]],
  );
});

test("validate and dry run: multiple targets, multiple entries, orphans", async () => {
  const [org] =
    await sql`insert into organizations (name) values ('DryPar') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'P', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  const obj = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "Acme" },
  });
  const w = (id: string) => ({ id, type: "wait", input: { duration: "1s" } });
  const def = {
    trigger: { type: "trigger.manual" },
    steps: [w("a"), w("b"), w("c"), w("d")],
    entry: ["a", "b"],
    next: { a: { done: ["c", "d"] } },
  };
  assert.deepEqual(await wf.validate(ctx, def), []);
  // Orphan: d is no longer reached; nonexistent target; nonexistent entry.
  assert.deepEqual(
    await wf.validate(ctx, {
      ...def,
      entry: ["a", "zz"],
      next: { a: { done: ["c", "yy"] } },
    }),
    [
      "entry: step zz does not exist",
      "a.done: step yy does not exist",
      "b: step not connected (no link from the trigger)",
      "d: step not connected (no link from the trigger)",
    ],
  );
  const [res] = await wf.dryRun(ctx, def, [record.id]);
  assert.equal(res!.error, undefined);
  assert.deepEqual(
    res!.paths.map((p) => [p.id, p.steps.map((s) => s.stepId)]),
    [
      ["0", ["a"]],
      ["0.0", ["c"]],
      ["0.1", ["d"]],
      ["1", ["b"]],
    ],
  );
  assert.equal(res!.path.length, 4);
});

test("trigger: unknown type and nonexistent object refused", async () => {
  const [org] =
    await sql`insert into organizations (name) values ('Trig') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'T', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  const v = (trigger: Record<string, unknown>) =>
    wf.validate(ctx, { trigger, steps: [] });
  assert.match((await v({ type: "zzz" })).join(), /trigger\.type/);
  assert.match(
    (await v({ type: "trigger.record_created", object: "nope" })).join(),
    /unknown object nope/,
  );
  assert.match((await v({ type: "trigger.event" })).join(), /trigger\.event/);
  assert.deepEqual(await v({ type: "trigger.event", eventType: "signup" }), []);
  assert.deepEqual(await v({ type: "trigger.manual" }), []);
});

async function owner(name: string) {
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, ${name}, ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id as string,
    workspaceId: ws!.id as string,
    actor: { userId: uid },
  };
}

test("validate: unknown variables reported, built-in and loop-local ones accepted", async () => {
  const ctx = await owner("Tpl");
  const errors = await wf.validate(ctx, {
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "a",
        type: "event.emit",
        input: {
          type: "x",
          payload: {
            ok: "{{now}} {{today}} {{run.id}} {{workflow.id}} {{event.a}}",
            bad: "{{recrod.nom}}",
            gone: "{{steps.zz.output}}",
          },
        },
      },
      {
        id: "l",
        type: "loop",
        input: {
          items: "{{record.list}}",
          do: [
            {
              id: "i1",
              type: "event.emit",
              input: { type: "y", payload: { v: "{{item.id}} {{index}}" } },
            },
            {
              id: "i2",
              type: "event.emit",
              input: { type: "y", payload: { v: "{{steps.i1.output}}" } },
            },
          ],
        },
      },
      {
        id: "b",
        type: "event.emit",
        input: { type: "z", payload: { v: "{{item.id}}" } },
      },
    ],
    next: { a: { ok: ["l"] }, l: { done: ["b"] } },
  });
  assert.deepEqual(errors, [
    "a: unknown variable {{recrod.nom}}",
    "a: {{steps.zz.output}}: step zz does not exist",
    "b: unknown variable {{item.id}}",
  ]);
});

test("dry run: event without record, input/output per step, join executed once, pinned output", async () => {
  const ctx = await owner("DryEvt");
  const def = {
    trigger: { type: "trigger.event", event: "paid" },
    steps: [
      {
        id: "a",
        type: "data.set",
        input: { values: { x: "{{event.amount}}" } },
      },
      { id: "b", type: "data.set", input: { values: { y: 2 } } },
      {
        id: "j",
        type: "data.set",
        join: true,
        input: {
          values: {
            sum: "{{steps.a.output.x}}+{{steps.b.output.y}}",
            day: "{{today}}",
          },
        },
      },
      { id: "api", type: "http.request", input: { url: "https://x.io" } },
    ],
    entry: ["a", "b"],
    next: { a: { ok: ["j"] }, b: { ok: ["j"] }, j: { ok: ["api"] } },
    pins: { api: { output: { status: 201 }, branch: "ok" } },
  };
  assert.deepEqual(await wf.validate(ctx, def), []);
  const [res] = await wf.dryRun(ctx, def, [], { event: { amount: 40 } });
  assert.equal(res!.recordId, null);
  assert.equal(res!.error, undefined);
  const j = res!.path.filter((s) => s.stepId === "j");
  assert.equal(j.length, 1);
  assert.deepEqual(j[0]!.output, {
    sum: "40+2",
    day: new Date().toISOString().slice(0, 10),
  });
  assert.deepEqual(res!.path[0]!.input, { values: { x: 40 } });
  const api = res!.path.find((s) => s.stepId === "api")!;
  assert.deepEqual(api.output, { status: 201 });
  assert.equal(api.pinned, true);
});

test("step test: provided input, outputs of the other steps, simulated effects", async () => {
  const ctx = await owner("TestStep");
  const def = {
    trigger: { type: "trigger.manual" },
    steps: [
      { id: "a", type: "data.set", input: { values: { v: 1 } } },
      {
        id: "b",
        type: "data.set",
        input: { values: { w: "{{steps.a.output.v}}" } },
      },
      { id: "c", type: "record.delete", input: { recordId: "{{record.id}}" } },
    ],
    next: { a: { ok: ["b"] }, b: { ok: ["c"] } },
    pins: { a: { output: { v: "pinned_value" } } },
  };
  const pinned = await wf.testStep(ctx, def, "b");
  assert.deepEqual(pinned.output, { w: "pinned_value" });
  const given = await wf.testStep(ctx, def, "b", {
    steps: { a: { v: 9 } },
  });
  assert.deepEqual(given.output, { w: 9 });
  const custom = await wf.testStep(ctx, def, "b", {
    input: { values: { w: "{{event.k}}" } },
    event: { k: "ev" },
  });
  assert.deepEqual(custom.output, { w: "ev" });
  const del = await wf.testStep(ctx, def, "c", {
    input: { recordId: crypto.randomUUID() },
  });
  assert.equal(del.simulated, true);
  await assert.rejects(wf.testStep(ctx, def, "zz"), /does not exist/);
});
