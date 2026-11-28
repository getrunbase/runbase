import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../errors/app-error";
import {
  enforceLint,
  lintFunction,
  lintKey,
  lintObject,
  lintWorkflow,
  MAX_FUNCTION_LINES,
} from "./index";

const codes = (ws: { code: string }[]) => ws.map((w) => w.code);

test("keys: snake_case English passes, kebab/camel/French warn", () => {
  assert.deepEqual(lintKey("Field key", "first_name"), []);
  assert.deepEqual(codes(lintKey("Object slug", "lead-source")), [
    "key.notSnakeCase",
  ]);
  assert.match(lintKey("Field key", "leadSource")[0]!.hint, /lead_source/);
  assert.deepEqual(codes(lintKey("Field key", "nom_societe")), [
    "key.notEnglish",
  ]);
});

test("objects: slug, keys and select options", () => {
  const ws = lintObject({
    slug: "contact",
    fields: [
      { key: "email", type: "email" },
      { key: "statut", type: "select", options: ["New", "🔥 Hot", "2. Won"] },
    ],
  });
  assert.deepEqual(codes(ws), [
    "key.notEnglish",
    "option.emoji",
    "option.numbered",
  ]);
  assert.match(ws[2]!.hint, /"Won"/);
  assert.deepEqual(
    lintObject({ fields: [{ key: "stage", options: ["New", "Won"] }] }),
    [],
  );
});

test("functions: wildcard domain, empty outputSchema, length, error write", () => {
  const clean = {
    code: "export default async (i) => ({ score: 1 })",
    outputSchema: { type: "object", properties: { score: { type: "number" } } },
    permissions: { domains: ["api.x.io"] },
  };
  assert.deepEqual(lintFunction(clean), []);
  assert.deepEqual(
    codes(lintFunction({ ...clean, permissions: { domains: ["*"] } })),
    ["function.wildcardDomain"],
  );
  assert.deepEqual(codes(lintFunction({ ...clean, outputSchema: {} })), [
    "function.emptyOutputSchema",
  ]);
  assert.deepEqual(
    codes(
      lintFunction({
        ...clean,
        outputSchema: { type: "object", properties: {} },
      }),
    ),
    ["function.emptyOutputSchema"],
  );
  const long = Array.from(
    { length: MAX_FUNCTION_LINES + 1 },
    (_, i) => `x${i}();`,
  ).join("\n");
  assert.deepEqual(codes(lintFunction({ ...clean, code: long })), [
    "function.tooLong",
  ]);
  const bad = `export default async (i, { records }) => {
  try { await fetch("https://api.x.io") } catch (e) {
    await records.update(i.id, { enrich_status: "failed" });
  }
}`;
  assert.deepEqual(codes(lintFunction({ ...clean, code: bad })), [
    "function.errorInRecord",
  ]);
  assert.deepEqual(
    codes(
      lintFunction({
        ...clean,
        code: "await records.upsert({ objectId: 'x', data: { note: err.message } })",
      }),
    ),
    ["function.errorInRecord"],
  );
});

test("workflows: a single fn.* step warns", () => {
  assert.deepEqual(
    codes(lintWorkflow({ steps: [{ id: "all", type: "fn.do-everything" }] })),
    ["workflow.singleFunction"],
  );
  assert.deepEqual(
    lintWorkflow({
      steps: [
        { id: "a", type: "fn.score" },
        { id: "b", type: "records.update" },
      ],
    }),
    [],
  );
  assert.deepEqual(
    lintWorkflow({ steps: [{ id: "a", type: "records.update" }] }),
    [],
  );
});

test("enforceLint: blocks only in strict mode", () => {
  const ws = lintKey("Field key", "Nom");
  enforceLint(ws, false);
  enforceLint([], true);
  assert.throws(
    () => enforceLint(ws, true),
    (e) =>
      e instanceof AppError &&
      e.code === "lint.failed" &&
      e.kind === "invalid_input",
  );
});

test("objects: plural slugs warn, singular words ending in s pass", () => {
  assert.deepEqual(codes(lintObject({ slug: "contacts" })), ["key.pluralSlug"]);
  assert.match(lintObject({ slug: "companies" })[0]!.hint, /company/);
  for (const slug of ["status", "address", "deal_status", "business", "news"])
    assert.deepEqual(lintObject({ slug }), [], slug);
});

test("functions: boolean outcome without a branch enum warns", () => {
  const fn = (props: object) =>
    codes(
      lintFunction({
        code: "x",
        outputSchema: { type: "object", properties: props },
      }),
    );
  assert.deepEqual(fn({ found: { type: "boolean" } }), [
    "function.booleanOutcome",
  ]);
  assert.deepEqual(fn({ is_valid: { type: "boolean" } }), [
    "function.booleanOutcome",
  ]);
  assert.deepEqual(fn({ score: { type: "number" } }), []);
  assert.deepEqual(
    fn({
      found: { type: "boolean" },
      branch: { type: "string", enum: ["found", "not_found"] },
    }),
    [],
  );
});

test("workflows: error written into a record warns", () => {
  const def = (data: object) => ({
    steps: [
      { id: "call", type: "http.request", retry: { continueOnFail: true } },
      { id: "save", type: "record.update", input: { recordId: "x", data } },
    ],
    next: { call: { ok: [], error: ["save"] } },
  });
  assert.deepEqual(
    codes(lintWorkflow(def({ note: "{{steps.call.output.error}}" }))),
    ["workflow.errorInRecord"],
  );
  assert.deepEqual(
    codes(lintWorkflow(def({ note: "Failed: {{steps.call.error.message}}" }))),
    ["workflow.errorInRecord"],
  );
  assert.deepEqual(
    lintWorkflow(def({ note: "{{steps.call.output.body}}" })),
    [],
  );
});

test("workflows: continueOnFail without an error branch warns", () => {
  const steps = [
    { id: "call", type: "http.request", retry: { continueOnFail: true } },
    { id: "b", type: "wait" },
  ];
  assert.deepEqual(
    codes(lintWorkflow({ steps, next: { call: { ok: ["b"] } } })),
    ["workflow.continueOnFailNoErrorBranch"],
  );
  assert.deepEqual(
    lintWorkflow({ steps, next: { call: { ok: ["b"], error: ["b"] } } }),
    [],
  );
});

test("workflows: human.approve expired branch that changes nothing warns", () => {
  const steps = [
    { id: "ask", type: "human.approve", input: { timeout: "2d" } },
    { id: "pause", type: "wait" },
    { id: "mark", type: "record.update" },
  ];
  assert.deepEqual(
    codes(lintWorkflow({ steps, next: { ask: { expired: ["pause"] } } })),
    ["workflow.approveExpiredNoop"],
  );
  assert.deepEqual(
    codes(lintWorkflow({ steps, next: { ask: { expired: [] } } })),
    ["workflow.approveExpiredNoop"],
  );
  assert.deepEqual(
    lintWorkflow({ steps, next: { ask: { expired: ["mark"] } } }),
    [],
  );
  // Not connected: the path fails, nothing silent.
  assert.deepEqual(lintWorkflow({ steps, next: {} }), []);
});
