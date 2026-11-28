// Agent lifecycle: staged drafts, realistic dry runs. Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { workflowsService as wf, definitionHash } from "./index";

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

const def = (n: number) => ({
  trigger: { type: "trigger.manual" },
  steps: [{ id: "s1", type: "wait", input: { duration: `${n}s` } }],
});

test("active workflow: untested update staged as a draft, dry run then activate promotes it", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("Stage");
  const w = await wf.create(a, { name: "Stage", definition: def(1) });
  assert.deepEqual(w.errors, []);
  await assert.rejects(
    wf.activateTested(a, "Stage"),
    (e: Error & { kind?: string }) =>
      e.kind === "untested" && /version: 1/.test(e.message),
  );
  assert.equal((await wf.dryRunWorkflow(a, "Stage"))!.tested, true);
  assert.equal((await wf.activateTested(a, w.id))!.status, "active");

  // New definition: staged, v1 stays live.
  const staged = (await wf.updateTested(a, w.id, { definition: def(2) })) as {
    staged?: boolean;
    draftVersion?: number;
    currentVersion: number;
  };
  assert.equal(staged.staged, true);
  assert.equal(staged.draftVersion, 2);
  assert.equal(staged.currentVersion, 1);
  const got = await wf.get(a, w.id);
  assert.deepEqual(got!.definition, def(1));
  assert.equal(got!.draftVersion, 2);
  assert.equal(got!.status, "active");

  // Activate before testing: refused, names the draft version.
  await assert.rejects(wf.activateTested(a, w.id), /Version 2 .*version: 2/);
  const dry = await wf.dryRunWorkflow(a, w.id);
  assert.equal(dry!.version, 2);
  assert.equal(dry!.tested, true);
  const promoted = (await wf.activateTested(a, w.id)) as {
    currentVersion: number;
    promoted?: number;
  };
  assert.equal(promoted.currentVersion, 2);
  assert.equal(promoted.promoted, 2);
  assert.deepEqual((await wf.get(a, w.id))!.definition, def(2));
  assert.equal((await wf.get(a, w.id))!.draftVersion, undefined);

  // Definition tested by hash before saving: goes live directly.
  const d3 = def(3);
  const pre = await wf.dryRunWorkflow(a, w.id, [], { definition: d3 });
  assert.equal(pre!.tested, true);
  assert.equal(pre!.version, null);
  const live = (await wf.updateTested(a, w.id, { definition: d3 })) as {
    currentVersion: number;
    staged?: boolean;
  };
  assert.equal(live.currentVersion, 3);
  assert.equal(live.staged, undefined);
  assert.equal(definitionHash(d3), definitionHash({ ...d3, layout: {} }));
});

test("create and update return validation errors", async () => {
  const a = await owner("Val");
  const bad = {
    trigger: { type: "trigger.manual" },
    steps: [
      { id: "a", type: "wait", input: { duration: "1s" } },
      { id: "orphan", type: "wait", input: { duration: "1s" } },
    ],
    next: { a: {} },
  };
  const w = await wf.create(a, { name: "Val", definition: bad });
  assert.ok(w.errors.length > 0);
  const u = (await wf.update(a, w.id, { definition: def(1) })) as unknown as {
    errors: string[];
  };
  assert.deepEqual(u.errors, []);
});

test("dry run: webhook sample mapped to a synthetic record, shape checked", async () => {
  const a = await owner("Hook");
  await objectsService.create(a, {
    slug: "lead",
    name: "Lead",
    fields: [
      { key: "email", label: "Email", type: "text", unique: true },
      { key: "name", label: "Name", type: "text" },
    ],
  });
  const definition = {
    trigger: {
      type: "trigger.webhook",
      webhook: "forms",
      object: "lead",
      match: "email",
      mapping: { email: "contact.email" },
    },
    steps: [
      {
        id: "save",
        type: "record.upsert",
        input: {
          object: "lead",
          match: "email",
          data: { email: "{{record.email}}", name: "{{record.name}}" },
        },
      },
      {
        id: "note",
        type: "record.update",
        input: {
          recordId: "{{steps.save.output.record.id}}",
          data: { name: "{{record.id}}" },
        },
      },
    ],
    next: { save: { created: ["note"], updated: ["note"] } },
  };
  const w = await wf.create(a, { name: "Hook", definition });
  // No webhook sample yet: skipped, not tested.
  const none = await wf.dryRunWorkflow(a, w.id);
  assert.equal(none!.tested, false);
  assert.match(none!.results[0]!.skipped!, /no stored sample/);

  await sql`insert into webhooks (organization_id, workspace_id, name, event_type, secret_name, config, sample)
    values (${a.organizationId}, ${a.workspaceId}, 'forms', 'form.submitted', 'FORMS_SECRET', '{}', ${sql.json({ contact: { email: "ann@x.io" } })})`;
  const dry = await wf.dryRunWorkflow(a, w.id);
  const r = dry!.results[0]!;
  assert.equal(dry!.tested, true, JSON.stringify(r));
  assert.equal(r.record!.email, "ann@x.io");
  const [save, note] = r.path;
  assert.ok(note, JSON.stringify(r, null, 1));
  assert.equal(
    (save!.input as { data: { email: string } }).data.email,
    "ann@x.io",
  );
  // Synthetic upserted record: its id flows to the next step.
  assert.match(
    (note!.input as { recordId: string }).recordId,
    /^[0-9a-f-]{36}$/,
  );
  // Empty {{record.name}}: warning.
  assert.ok(r.warnings?.some((x) => x.includes("record.name")));
  // Nothing written.
  const leads = await recordsService.search(
    a,
    (await objectsService.get(a, "lead"))!.id,
  );
  assert.equal(leads.length, 0);

  // Event that is not shaped like the sample: refused.
  await assert.rejects(
    wf.dryRunWorkflow(a, w.id, [], { event: { email: "ann@x.io" } }),
    /does not match the stored sample/,
  );
});

test("dry run: schedule on an object samples matching records", async () => {
  const a = await owner("Cron");
  const obj = await objectsService.create(a, {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "stage", label: "Stage", type: "text" }],
  });
  const definition = {
    trigger: {
      type: "trigger.schedule",
      cron: "0 9 * * *",
      object: "deal",
      filter: { all: [{ field: "stage", op: "eq", value: "open" }] },
    },
    steps: [{ id: "s1", type: "wait", input: { duration: "1s" } }],
  };
  const w = await wf.create(a, { name: "Cron", definition });
  const empty = await wf.dryRunWorkflow(a, w.id);
  assert.equal(empty!.tested, false);
  assert.match(empty!.results[0]!.skipped!, /No deal record matches/);

  await recordsService.upsert(a, { objectId: obj.id, data: { stage: "won" } });
  const open = await recordsService.upsert(a, {
    objectId: obj.id,
    data: { stage: "open" },
  });
  const dry = await wf.dryRunWorkflow(a, w.id);
  assert.equal(dry!.tested, true);
  assert.deepEqual(
    dry!.results.map((r) => r.recordId),
    [open.record.id],
  );
});

test("dry run: failure after a simulated null output carries a pin hint", async () => {
  const a = await owner("Pin");
  const definition = {
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "call",
        type: "http.request",
        input: { url: "https://example.com", method: "POST" },
      },
      {
        id: "wait",
        type: "wait",
        input: { duration: "{{steps.call.output.body.delay}}" },
      },
    ],
    next: { call: { ok: ["wait"] } },
  };
  const w = await wf.create(a, { name: "Pin", definition });
  const dry = await wf.dryRunWorkflow(a, w.id);
  const r = dry!.results[0]!;
  assert.equal(dry!.tested, false, JSON.stringify(r));
  assert.match(r.hint ?? "", /Step call .*pins/);
});
