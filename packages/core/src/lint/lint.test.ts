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
    slug: "contacts",
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
