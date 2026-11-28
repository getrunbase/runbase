// Dry run fidelity: what dry_run / test_step report matches a real run and
// never claims "tested" falsely. Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { workflowsService as wf } from "./index";

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

const manual = { type: "trigger.manual" };

test("stopping at the first condition is not a test; coverage lists unreached steps", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("Cond");
  const definition = {
    trigger: manual,
    steps: [
      {
        id: "c",
        type: "condition",
        input: { left: "a", op: "eq", right: "b" },
      },
      { id: "s2", type: "wait", input: { duration: "1s" } },
    ],
    next: { c: { true: ["s2"] } },
  };
  const w = await wf.create(a, { name: "Cond", definition });
  const dry = (await wf.dryRunWorkflow(a, w.id))!;
  assert.equal(dry.tested, false);
  assert.match(dry.blocking!.join("\n"), /Nothing ran after c/);
  assert.deepEqual(dry.coverage, { ran: 1, total: 2, unreached: ["s2"] });

  // Pinning the condition branch exercises what follows.
  const pinned = (await wf.dryRunWorkflow(a, w.id, [], {
    definition: { ...definition, pins: { c: { branch: "true" } } },
  }))!;
  assert.equal(pinned.tested, true);
  assert.deepEqual(pinned.coverage.unreached, []);
});

test("validation errors block tested and are listed", async () => {
  const a = await owner("Invalid");
  const w = await wf.create(a, {
    name: "Invalid",
    definition: {
      trigger: manual,
      steps: [{ id: "s1", type: "wait", input: { duration: "1s" } }],
    },
  });
  const dry = (await wf.dryRunWorkflow(a, w.id, [], {
    definition: {
      trigger: manual,
      steps: [{ id: "s1", type: "wait", input: { duration: "1s" } }],
      next: { ghost: { ok: ["s1"] } },
    },
  }))!;
  assert.equal(dry.tested, false);
  assert.match(dry.blocking!.join("\n"), /ghost/);
});

test("simulated writes: empty match value fails, field defaults applied", async () => {
  const a = await owner("Write");
  await objectsService.create(a, {
    slug: "lead",
    name: "Lead",
    fields: [
      { key: "email", label: "Email", type: "text", unique: true },
      { key: "status", label: "Status", type: "text", default: "new" },
    ],
  });
  const [upsert] = await wf.dryRun(a, {
    trigger: manual,
    steps: [
      {
        id: "u",
        type: "record.upsert",
        input: { object: "lead", match: "email", data: { email: "" } },
      },
    ],
  });
  assert.match(upsert!.error!, /match: value required \(email\)/);

  const [create] = await wf.dryRun(a, {
    trigger: manual,
    steps: [
      {
        id: "c",
        type: "record.create",
        input: { object: "lead", data: { email: "x@y.io" } },
      },
    ],
  });
  const out = create!.path[0]!.output as { record: Record<string, unknown> };
  assert.equal(out.record.status, "new");
});

test("human.approve: hint to pin a branch, run refs warned; pinned error takes the error branch", async () => {
  const a = await owner("Approve");
  const [r] = await wf.dryRun(a, {
    trigger: manual,
    steps: [
      { id: "ok", type: "human.approve", input: { message: "Run {{run.id}}" } },
      { id: "s2", type: "wait", input: { duration: "1s" } },
    ],
    next: { ok: { approved: ["s2"] } },
  });
  assert.match(r!.paths[0]!.hint!, /branch: "approved"/);
  assert.match(r!.warnings!.join("\n"), /run\.id.*null in a dry run/);

  const [e] = await wf.dryRun(a, {
    trigger: manual,
    steps: [
      {
        id: "w",
        type: "wait",
        input: { duration: "1s" },
        retry: { continueOnFail: true },
      },
      { id: "onErr", type: "wait", input: { duration: "1s" } },
    ],
    next: { w: { error: ["onErr"] } },
    pins: { w: { error: "boom" } },
  });
  assert.deepEqual(
    e!.path.map((s) => [s.stepId, s.branch]),
    [
      ["w", "error"],
      ["onErr", "done"],
    ],
  );
});

test("trigger.event: an event wrapped in { payload } is warned", async () => {
  const a = await owner("Evt");
  const [r] = await wf.dryRun(
    a,
    {
      trigger: { type: "trigger.event", event: "lead.signed" },
      steps: [
        { id: "m", type: "human.approve", input: { message: "{{event.x}}" } },
      ],
    },
    [],
    { event: { payload: { x: 1 } } },
  );
  const w = r!.warnings!.join("\n");
  assert.match(w, /top-level `payload` key/);
  assert.match(w, /event\.x.*renders empty/);
});

test("test_step: saved workflow by name, live writes flagged isTest", async () => {
  const a = await owner("Step");
  await objectsService.create(a, {
    slug: "note",
    name: "Note",
    fields: [{ key: "title", label: "Title", type: "text" }],
  });
  await wf.create(a, {
    name: "Step",
    definition: {
      trigger: manual,
      steps: [
        {
          id: "c",
          type: "record.create",
          input: { object: "note", data: { title: "hi" } },
        },
      ],
    },
  });
  const r = (await wf.testStep(a, { workflow: "Step" }, "c", {
    live: true,
  })) as unknown as { output: { record: { id: string } }; test?: boolean };
  assert.equal(r.test, true);
  const [row] =
    await sql`select is_test from records where id = ${r.output.record.id}`;
  assert.equal(row!.is_test, true);
});

test("a branch ending in stop.error is an expected stop; unreached writes block tested", async () => {
  const a = await owner("Stop");
  await objectsService.create(a, {
    slug: "memo",
    name: "Memo",
    fields: [{ key: "title", label: "Title", type: "text" }],
  });
  const stop = {
    trigger: manual,
    steps: [
      {
        id: "c",
        type: "condition",
        input: { left: "a", op: "eq", right: "b" },
      },
      { id: "fail", type: "stop.error", input: { message: "Not eligible" } },
      { id: "s2", type: "wait", input: { duration: "1s" } },
    ],
    next: { c: { true: ["s2"], false: ["fail"] } },
  };
  const w = await wf.create(a, { name: "Stop", definition: stop });
  const dry = (await wf.dryRunWorkflow(a, w.id))!;
  assert.equal(dry.tested, true);
  const last = dry.results[0]!.path.at(-1)!;
  assert.equal(last.stepId, "fail");
  assert.match(last.reason, /stops the run: Not eligible/);

  // The write behind the branch not taken was never exercised.
  const write = {
    trigger: manual,
    steps: [
      {
        id: "c",
        type: "condition",
        input: { left: "a", op: "eq", right: "b" },
      },
      { id: "s2", type: "wait", input: { duration: "1s" } },
      {
        id: "save",
        type: "record.create",
        input: { object: "memo", data: { title: "x" } },
      },
    ],
    next: { c: { true: ["save"], false: ["s2"] } },
  };
  const unreached = (await wf.dryRunWorkflow(a, w.id, [], {
    definition: write,
  }))!;
  assert.equal(unreached.tested, false);
  assert.match(unreached.blocking!.join("\n"), /side-effect steps save/);
});
