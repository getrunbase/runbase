// Validation of fn.<name> steps: required inputs, refs to the
// declared outputs and the trigger fields. Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { functionsService } from "../functions";
import { objectsService } from "../objects";
import type { TenantContext } from "../tenant";
import { secretsService } from "../secrets";
import { workflowsService as wf, type InvalidWorkflow } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

export async function tenant(name: string): Promise<TenantContext> {
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

test("fn.<name>: valid refs, ref to a missing field, missing required input", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const ctx = await tenant("FnRefs");
  await objectsService.create(ctx, {
    slug: "lead",
    name: "Lead",
    fields: [{ key: "email", label: "Email", type: "text" }],
  });
  await functionsService.save(ctx, {
    name: "find",
    code: "export default () => ({ leadId: 'x' })",
    outputSchema: {
      type: "object",
      properties: { leadId: { type: "string" } },
    },
  });
  await functionsService.save(ctx, {
    name: "follow",
    code: "export default (i) => i",
    inputSchema: {
      type: "object",
      properties: { leadId: { type: "string" }, email: { type: "string" } },
      required: ["leadId"],
    },
  });
  const def = (input: Record<string, unknown>, trigger?: unknown) => ({
    trigger: trigger ?? { type: "trigger.record_created", object: "lead" },
    steps: [
      { id: "a", type: "fn.find", input: {} },
      { id: "b", type: "fn.follow", input },
    ],
    next: { a: { ok: ["b"] } },
  });

  const ok = await wf.check(
    ctx,
    def({ leadId: "{{steps.a.output.leadId}}", email: "{{record.email}}" }),
  );
  assert.deepEqual(ok, { errors: [], warnings: [] });

  const bad = await wf.check(
    ctx,
    def({ leadId: "{{steps.a.output.lead_id}}", email: "{{record.mail}}" }),
  );
  assert.deepEqual(
    bad.errors.map((e) => e.code),
    ["workflows.unknownRefField", "workflows.unknownRecordField"],
  );
  assert.match(bad.errors[0]!.message, /a has no output field lead_id/);

  const missing = await wf.check(ctx, def({ email: "{{record.email}}" }));
  assert.equal(missing.errors[0]!.code, "workflows.missingFunctionInput");
  assert.match(missing.errors[0]!.message, /missing required input leadId/);

  // Unknown schema (event): warning, not error.
  const dynamic = await wf.check(
    ctx,
    def({ leadId: "{{event.leadId}}" }, { type: "trigger.event", event: "x" }),
  );
  assert.deepEqual(dynamic.errors, []);
  assert.equal(dynamic.warnings[0]!.code, "workflows.unverifiedRef");

  // Dry run: ref resolving to undefined = readable error with path.
  const [run] = await wf.dryRun(
    ctx,
    def({ leadId: "{{event.nope}}" }, { type: "trigger.event", event: "x" }),
    [],
    { event: {} },
  );
  assert.match(
    run!.error!,
    /Invalid input leadId: expected string, received undefined/,
  );
});

test("function secrets: validate reports, activate refuses then accepts", async () => {
  const ctx = await tenant("FnSecrets");
  await functionsService.save(ctx, {
    name: "sync",
    code: "export default () => ({})",
    permissions: { domains: [], secrets: ["STRIPE_READ_KEY"] },
  });
  await functionsService.save(ctx, {
    name: "local",
    code: "export default () => fetch('http://localhost:4350/x')",
  });
  const definition = {
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "l",
        type: "loop",
        input: { items: [1], do: [{ id: "s", type: "fn.sync", input: {} }] },
      },
      { id: "x", type: "fn.local", input: {} },
    ],
    next: { l: { done: ["x"] } },
  };
  const r = await wf.check(ctx, definition);
  assert.deepEqual(
    r.errors.map((e) => [e.code, e.params]),
    [["workflows.missingSecret", { name: "STRIPE_READ_KEY" }]],
  );
  assert.deepEqual(
    r.warnings.map((e) => e.code),
    ["workflows.localhostUrl"],
  );
  const w = await wf.create(ctx, { name: "secrets", definition });
  await assert.rejects(wf.activate(ctx, w.id), (e: InvalidWorkflow) =>
    e.items.some(
      (i) =>
        i.code === "workflows.missingSecret" &&
        i.message === "Missing secret STRIPE_READ_KEY",
    ),
  );
  await secretsService.set(ctx, "STRIPE_READ_KEY", "sk_test");
  assert.deepEqual((await wf.check(ctx, definition)).errors, []);
  assert.equal((await wf.activate(ctx, w.id))!.status, "active");
});
