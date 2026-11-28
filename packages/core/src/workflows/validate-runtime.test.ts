// Validate-time checks for mistakes that otherwise fail only at run time.
// Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { z } from "zod";
import { blocks, defineBlock } from "../blocks";
import { objectsService } from "../objects";
import { secretsService } from "../secrets";
import { webhooksService } from "../webhooks";
import { workflowsService as wf } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

const codes = (items: { code: string }[]) => items.map((i) => i.code);

test("validate: runtime-only mistakes caught before the run", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const [org] =
    await sql`insert into organizations (name) values ('Lint') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name, settings) values (${org!.id}, 'Default', ${sql.json({ allowedDomains: ["api.ok.io"] })}) returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'L', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  const lead = await objectsService.create(ctx, {
    slug: "lead",
    name: "Lead",
    fields: [
      { key: "email", label: "Email", type: "text", unique: true },
      { key: "name", label: "Name", type: "text" },
      { key: "since", label: "Since", type: "date" },
    ],
  });
  await secretsService.set(ctx, "HOOK", "k");
  await webhooksService.create(ctx, {
    name: "form",
    eventType: "form.submitted",
    secretName: "HOOK",
    config: { format: "hmac", header: "x-sig" } as never,
  });
  await sql`update webhooks set sample = ${sql.json({ contact: { email: "a@b.io", first: "Ann" }, kind: "lead" })} where workspace_id = ${ws!.id}`;
  const check = (definition: unknown) => wf.check(ctx, definition);

  // (1) Mapping and match resolved against the sample.
  let r = await check({
    trigger: {
      type: "trigger.webhook",
      webhook: "form",
      object: "lead",
      match: "email",
      mapping: { email: "contact.mail", name: "payload.contact.first" },
    },
    steps: [],
  });
  assert.deepEqual(codes(r.errors), ["workflows.matchUndefined"]);
  assert.deepEqual(codes(r.warnings), [
    "workflows.mappingPathMissing",
    "workflows.mappingPayloadPrefix",
  ]);
  r = await check({
    trigger: {
      type: "trigger.webhook",
      webhook: "form",
      object: "lead",
      match: "email",
      mapping: { name: "contact.first" },
    },
    steps: [],
  });
  assert.deepEqual(codes(r.errors), ["workflows.matchNotMapped"]);

  // (2) OAuth block without a connection.
  blocks["test.oauth"] = defineBlock({
    type: "test.oauth",
    label: "test.oauth",
    description: "",
    sideEffect: true,
    inputSchema: z.object({ connection: z.string().optional() }),
    outputSchema: z.object({}),
    branches: ["ok"],
    run: async () => ({ branch: "ok", output: {} }),
  });
  blocks["test.oauth"]!.oauthProvider = "google";
  r = await check({
    trigger: { type: "trigger.manual" },
    steps: [{ id: "send", type: "test.oauth", input: {} }],
  });
  assert.deepEqual(codes(r.errors), ["workflows.missingConnection"]);

  // (3) Secrets of ai.* steps and {{secret.X}} refs.
  r = await check({
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "sum",
        type: "ai.run",
        input: { prompt: "Hi", ai: { provider: "anthropic", secret: "AI_K" } },
      },
      {
        id: "call",
        type: "http.request",
        input: {
          url: "https://api.ok.io/x",
          headers: { authorization: "Bearer {{secret.API_K}}" },
        },
      },
    ],
    next: { sum: { ok: ["call"] } },
  });
  assert.deepEqual(
    r.errors.map((e) => e.message).sort(),
    ["Missing secret AI_K", "Missing secret API_K"],
  );

  // (4) Filter value schemas: durations in integer days.
  r = await check({
    trigger: {
      type: "trigger.schedule",
      cron: "0 8 * * *",
      object: "lead",
      filter: { field: "since", op: "older_than", value: "3d" },
    },
    steps: [
      {
        id: "find",
        type: "record.search",
        input: {
          object: lead.id,
          filter: { field: "since", op: "within", value: "3d" },
        },
      },
    ],
  });
  assert.equal(r.errors.length, 2);
  for (const e of r.errors)
    assert.match(e.message, /expected integer number of days, got "3d"/);

  // (5) Step refs read `output`, declared keys; event refs vs the sample.
  r = await check({
    trigger: { type: "trigger.webhook", webhook: "form" },
    steps: [
      {
        id: "find",
        type: "record.search",
        input: { object: "lead" },
      },
      {
        id: "set",
        type: "record.update",
        input: {
          recordId: "{{steps.find.records.0.id}}",
          data: {
            name: "{{steps.find.output.rows}}",
            email: "{{event.payload.contact.email}}",
            stage: "{{event.contact.email}} {{event.recordId}}",
          },
        },
      },
    ],
    next: { find: { found: ["set"], empty: ["set"] } },
  });
  assert.deepEqual(codes(r.errors).sort(), [
    "workflows.stepRefNotOutput",
    "workflows.unknownRefField",
  ]);
  assert.deepEqual(codes(r.warnings), ["workflows.unknownEventPath"]);

  // (6) unknownBranch lists the valid ones; (7) continueOnFail adds `error`.
  r = await check({
    trigger: { type: "trigger.manual" },
    steps: [
      { id: "a", type: "http.request", input: { url: "https://api.ok.io" } },
      {
        id: "b",
        type: "ai.run",
        input: { prompt: "x" },
        retry: { continueOnFail: true },
      },
      { id: "c", type: "wait", input: { duration: "1s" } },
    ],
    next: { a: { yes: ["b"] }, b: { error: ["c"] } },
  });
  assert.deepEqual(
    r.errors.map((e) => e.message),
    ["a: unknown branch yes (valid: ok, error)"],
  );
  assert.equal(r.errors[0]!.params.valid, "ok, error");

  // (8) Switch without default; unconnected empty / false branches in a
  // webhook workflow. (9) http host outside allowedDomains.
  r = await check({
    trigger: { type: "trigger.webhook", webhook: "form" },
    steps: [
      {
        id: "sw",
        type: "switch",
        input: {
          value: "{{event.kind}}",
          cases: [{ id: "lead", label: "Lead", op: "eq", value: "lead" }],
        },
      },
      { id: "find", type: "record.search", input: { object: "lead" } },
      {
        id: "cond",
        type: "condition",
        input: { left: "{{event.kind}}", op: "eq", right: "lead" },
      },
      { id: "out", type: "http.request", input: { url: "https://evil.io/x" } },
    ],
    next: {
      sw: { lead: ["find"] },
      find: { found: ["cond"] },
      cond: { true: ["out"] },
    },
  });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(
    r.warnings.map((w) => w.message),
    [
      "sw: switch has no default (else) branch connected",
      "find: branch empty is not connected, the run ends there silently",
      "cond: branch false is not connected, the run ends there silently",
      "out: evil.io is not in the workspace allowed domains, the request will be refused",
    ],
  );

  // (10) Condition given an object uuid: resolved to its slug.
  r = await check({
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "c",
        type: "condition",
        input: {
          object: lead.id,
          recordId: "{{record.id}}",
          condition: { field: "email", op: "contains", value: "@" },
        },
      },
    ],
  });
  assert.deepEqual(r.errors, []);
});
