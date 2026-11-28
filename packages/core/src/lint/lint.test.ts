import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../errors/app-error";
import {
  assertSingularSlug,
  toSnake,
  enforceLint,
  lintFunction,
  lintKey,
  lintNote,
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

test("objects: option punctuation, mixed case and mixed language", () => {
  const ws = lintObject({
    fields: [
      { key: "stage", options: ["New", "won", "Lost!"] },
      { key: "status", options: ["Open", "Gagné"] },
      { key: "tier", options: ["Gold", "Silver"] },
    ],
  });
  assert.deepEqual(codes(ws), [
    "option.punctuation",
    "option.mixedCase",
    "option.mixedLanguage",
  ]);
  assert.match(ws[0]!.hint, /"Lost"/);
  assert.equal(ws[2]!.path, "status");
});

test("slugs: plural slug refused with the singular as suggestion", () => {
  assert.throws(
    () => assertSingularSlug("contacts"),
    (e: unknown) =>
      e instanceof AppError &&
      e.code === "objects.pluralSlug" &&
      /Use contact$/.test(e.message),
  );
  assert.doesNotThrow(() => assertSingularSlug("contact"));
  assert.doesNotThrow(() => assertSingularSlug("status"));
  assert.equal(toSnake("Sales Pipeline"), "sales_pipeline");
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

test("objects: mixed option casing warns", () => {
  assert.deepEqual(
    codes(
      lintObject({
        fields: [
          { key: "stage", options: ["new", "won"] },
          { key: "priority", options: ["High", "Low"] },
        ],
      }),
    ),
    ["option.mixedCasing"],
  );
  assert.deepEqual(
    lintObject({
      fields: [
        { key: "stage", options: ["new", "in_progress"] },
        { key: "tier", options: ["a1", "42"] },
      ],
    }),
    [],
  );
});

test("functions: { ok, error } is the failure convention, not an outcome", () => {
  const schema = (props: object) => ({
    code: "export default async () => ({ ok: true })",
    outputSchema: { type: "object", properties: props },
  });
  assert.deepEqual(
    lintFunction(
      schema({ ok: { type: "boolean" }, error: { type: "string" } }),
    ),
    [],
  );
  assert.deepEqual(codes(lintFunction(schema({ ok: { type: "boolean" } }))), [
    "function.booleanOutcome",
  ]);
  assert.deepEqual(
    codes(
      lintFunction(
        schema({ found: { type: "boolean" }, error: { type: "string" } }),
      ),
    ),
    ["function.booleanOutcome"],
  );
});

test("functions: branching on the test flag warns", () => {
  const base = {
    outputSchema: { type: "object", properties: { n: { type: "number" } } },
  };
  for (const code of [
    "export default async (i, ctx) => { if (ctx.test) return { n: 0 }; }",
    "export default async (i, { test }) => { if (!test) await send(); }",
    "export default async (i, { test }) => ({ n: test ? 0 : 1 })",
  ])
    assert.deepEqual(codes(lintFunction({ ...base, code })), [
      "function.branchesOnTest",
    ]);
  assert.deepEqual(
    lintFunction({ ...base, code: "const latest = x ?? 1; testValue(1)" }),
    [],
  );
  // Skipping an external post in test runs is the documented pattern.
  assert.deepEqual(
    lintFunction({
      ...base,
      code: "export default async (i, { secrets, test }) => { if (test) return { n: 0 }; }",
      permissions: { domains: ["slack.com"], secrets: ["SLACK_TOKEN"] },
    }),
    [],
  );
});

test("notes: a workflow or function without a note warns", () => {
  assert.deepEqual(codes(lintNote("workflow", "score", false)), [
    "workflow.noNote",
  ]);
  assert.deepEqual(codes(lintNote("function", "enrich", false)), [
    "function.noNote",
  ]);
  assert.deepEqual(lintNote("function", "enrich", true), []);
});

test("workflows: record_updated loop and stage race", () => {
  const write = (data: object, recordId = "{{record.id}}") => ({
    id: "w",
    type: "record.update",
    input: { recordId, data },
  });
  const updated = (fields?: string[]) => ({
    type: "trigger.record_updated",
    object: "deal",
    ...(fields && { fields }),
  });
  assert.deepEqual(
    codes(lintWorkflow({ trigger: updated(), steps: [write({ score: 1 })] })),
    ["workflow.writesTriggerField"],
  );
  assert.deepEqual(
    codes(
      lintWorkflow({
        trigger: updated(["stage"]),
        steps: [write({ stage: "won" })],
      }),
    ),
    ["workflow.writesTriggerField"],
  );
  assert.deepEqual(
    lintWorkflow({ trigger: updated(["stage"]), steps: [write({ score: 1 })] }),
    [],
  );
  assert.deepEqual(
    lintWorkflow({
      trigger: updated(),
      steps: [write({ score: 1 }, "{{steps.find.output.id}}")],
    }),
    [],
  );
  const event = { type: "trigger.event", event: "payment.received" };
  assert.deepEqual(
    codes(lintWorkflow({ trigger: event, steps: [write({ stage: "paid" })] })),
    ["workflow.stageRaceNoConcurrencyKey"],
  );
  assert.deepEqual(
    lintWorkflow({
      trigger: event,
      concurrencyKey: "{{event.recordId}}",
      steps: [write({ stage: "paid" })],
    }),
    [],
  );
  assert.deepEqual(
    lintWorkflow({ trigger: event, steps: [write({ amount: 3 })] }),
    [],
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
  // The error branch ends in stop.error: the run still fails visibly.
  const stopped = def({ note: "{{steps.call.output.error}}" });
  stopped.steps.push({
    id: "fail",
    type: "stop.error",
    input: { message: "x" },
  } as never);
  (stopped.next as Record<string, unknown>).save = { ok: ["fail"] };
  assert.deepEqual(lintWorkflow(stopped), []);
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
