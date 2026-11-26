// Input schemas of the server actions (issue #4).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as root from "./inputs";
import * as workflows from "./workflows/inputs";
import * as functions from "./functions/inputs";
import * as databases from "./databases/inputs";
import { catalogInput } from "./templates/import/inputs";
import { toggleInput } from "./admin/feedback/inputs";
import * as secrets from "./settings/secrets/inputs";

const fails = (
  s: { safeParse: (v: unknown) => { success: boolean } },
  v: unknown,
) => assert.equal(s.safeParse(v).success, false);

test("root: ids, names, roles, limits, invitation, budget", () => {
  fails(root.idInput, {});
  assert.deepEqual(root.nameInput.parse({ name: "  Acme " }), { name: "Acme" });
  assert.deepEqual(root.nameInput.parse({}), { name: "" });
  assert.equal(root.roleInput.parse({ id: "u1", role: "admin" }).role, "admin");
  assert.equal(
    root.roleInput.parse({ id: "u1", role: "owner!" }).role,
    "member",
  );
  assert.equal(root.inviteInput.parse({ email: "" }).role, "member");
  fails(root.inviteInput, { email: "not-an-email" });
  // Workspace picker: switch on = all (null), otherwise the checked ids.
  const ws = "6f1c2b9e-2d4a-4c3b-9a1e-0b5d7e8f9a10";
  assert.equal(
    root.inviteInput.parse({ email: "", all: "1", workspaceIds: ws }).workspaceIds,
    null,
  );
  assert.deepEqual(
    root.inviteInput.parse({ email: "", workspaceIds: [ws] }).workspaceIds,
    [ws],
  );
  fails(root.inviteInput, { email: "", workspaceIds: "nope" });
  assert.deepEqual(
    root.workspacesInput.parse({ id: "m1", workspaceIds: ws }).workspaceIds,
    [ws],
  );
  assert.equal(
    root.limitsInput.parse({ records: "10", concurrency: "" }).records,
    10,
  );
  fails(root.limitsInput, { records: "abc" });
  fails(root.limitsInput, { records: "-1" });
  assert.equal(
    root.answerInput.parse({ organizationId: "o", accept: "1" }).accept,
    true,
  );
  assert.equal(root.answerInput.parse({ organizationId: "o" }).accept, false);
  assert.equal(root.budgetInput.parse({ budget: "" }).budget, null);
  assert.equal(root.budgetInput.parse({ budget: "12.5" }).budget, 12.5);
  fails(root.budgetInput, { budget: "x" });
});

test("workflows: definition shape, status, restore", () => {
  const definition = { trigger: { type: "trigger.manual" }, steps: [] };
  assert.equal(
    workflows.saveInput.parse({ id: "w", name: "A", definition }).id,
    "w",
  );
  fails(workflows.definition, { trigger: {}, steps: "x" });
  fails(workflows.definition, null);
  fails(workflows.dryRunInput, { definition, recordIds: [1] });
  fails(workflows.statusInput, { id: "w", status: "deleted" });
  fails(workflows.restoreInput, { id: "w", version: 0 });
  assert.equal(workflows.createInput.parse({}).name, "");
});

test("functions: json, csv lists, version", () => {
  const r = functions.saveInput.parse({
    name: "f",
    code: "x",
    inputSchema: '{"a":1}',
    domains: "a.com, b.com,",
  });
  assert.deepEqual(r.inputSchema, { a: 1 });
  assert.deepEqual(r.outputSchema, {});
  assert.deepEqual(r.domains, ["a.com", "b.com"]);
  assert.deepEqual(r.secrets, []);
  fails(functions.saveInput, { name: "f", code: "x", inputSchema: "{" });
  fails(functions.saveInput, { name: "", code: "x" });
  assert.equal(
    functions.restoreInput.parse({ name: "f", version: "3" }).version,
    3,
  );
  fails(functions.restoreInput, { name: "f", version: "x" });
  assert.equal(
    functions.testInput.parse({ name: "f", version: "" }).version,
    undefined,
  );
});

test("databases: names and fields", () => {
  assert.equal(
    databases.createInput.parse({ name: "CRM", object: "Deals" }).fields,
    undefined,
  );
  fails(databases.createInput, { name: "", object: "Deals" });
  fails(databases.createInput, {
    name: "CRM",
    object: "D",
    fields: [{ key: "" }],
  });
  assert.equal(databases.templateInput.parse({}).template, "");
});

test("templates, feedback, secrets", () => {
  fails(catalogInput, { template: "" });
  assert.deepEqual(toggleInput.parse({ id: "1", resolved: "1" }), {
    id: "1",
    resolved: true,
  });
  fails(toggleInput, {});
  assert.equal(secrets.setInput.parse({ name: " K ", value: "v" }).name, "K");
  fails(secrets.setInput, { name: "K" });
  fails(secrets.nameInput, { name: "" });
});
