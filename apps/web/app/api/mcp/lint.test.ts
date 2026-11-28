// Definition lint through MCP: warnings returned on save, blocking error in
// a strict workspace. Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { workspacesService } from "@getrunbase/core/workspaces";
import { client, owner, raw } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

const codes = (ws: { code: string }[] | undefined) =>
  (ws ?? []).map((w) => w.code);

test("non-compliant definitions return lint warnings, strict mode blocks", async () => {
  const ctx = await owner();
  const call = client(ctx);

  const obj = await call("objects.create", {
    slug: "prospect",
    name: "Prospects",
    fields: [
      { key: "nom_societe", label: "Company", type: "text" },
      {
        key: "stage",
        label: "Stage",
        type: "select",
        options: ["1. New", "Won"],
      },
    ],
  });
  assert.deepEqual(codes(obj.lint), ["key.notEnglish", "option.numbered"]);
  const fixed = await call("objects.update_schema", {
    object: "prospect",
    fields: [
      { key: "company", label: "Company", type: "text" },
      { key: "stage", label: "Stage", type: "select", options: ["New", "Won"] },
    ],
  });
  assert.equal(fixed.lint, undefined);

  // Plural slug refused at creation, with the singular as suggestion.
  const plural = await raw(ctx)("objects.create", {
    slug: "prospects",
    name: "Prospects",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  assert.equal(plural.isError, true);
  assert.match(plural.content[0]!.text, /singular\. Use prospect/);

  // update_schema lints the merged object: name-only patch keeps warnings.
  await call("objects.update_schema", {
    object: "prospect",
    fields: [
      { key: "company", label: "Company", type: "text" },
      { key: "stage", label: "Stage", type: "select", options: ["New", "won"] },
    ],
  });
  const renamed = await call("objects.update_schema", {
    object: "prospect",
    name: "Leads",
  });
  assert.deepEqual(codes(renamed.lint), ["option.mixedCase"]);

  // databases.create: slug derived from the name when omitted.
  const db = await call("databases.create", { name: "Sales Pipeline" });
  assert.equal(db.slug, "sales_pipeline");

  const fn = await call("functions.save", {
    name: "do-everything",
    code: "export default async () => ({})",
    permissions: { domains: ["*"] },
  });
  assert.deepEqual(codes(fn.lint), [
    "function.wildcardDomain",
    "function.emptyOutputSchema",
  ]);

  const definition = {
    trigger: { type: "trigger.manual" },
    steps: [{ id: "all", type: "fn.do-everything", input: {} }],
  };
  const v = await call("workflows.validate", { definition });
  assert.deepEqual(codes(v.lint), ["workflow.singleFunction"]);
  const wf = await call("workflows.create", { name: "All", definition });
  assert.deepEqual(codes(wf.lint), ["workflow.singleFunction"]);

  await workspacesService.setSettings(ctx, { lintStrict: true });
  const r = await raw(ctx)("functions.save", {
    name: "do-everything",
    code: "export default async () => ({})",
    permissions: { domains: ["*"] },
  });
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /^\[invalid_input\] Definition rejected/);
});
