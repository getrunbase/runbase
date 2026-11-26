import { test } from "node:test";
import assert from "node:assert/strict";
import {
  denied,
  parseCall,
  permissionsSchema,
  READ_METHODS,
  WRITE_METHODS,
} from "./sdk";

const U = "00000000-0000-4000-8000-000000000001";
const none = permissionsSchema.parse(undefined);
const all = permissionsSchema.parse({
  objects: ["deals"],
  write: ["deals"],
  workflows: [U],
  files: true,
  ai: { default: { provider: "openai", secret: "OPENAI_API_KEY" } },
});

// One valid call per method: refused without permission, allowed with it.
const calls: Record<string, unknown> = {
  query: { object: "deals", limit: 10, after: U },
  aggregate: {
    object: "deals",
    groupBy: "stage",
    aggregate: [{ op: "sum", field: "amount", as: "total" }],
  },
  record: { id: U },
  timeline: { recordId: U },
  object: { id: "deals" },
  user: {},
  create: { object: "deals", data: { name: "x" } },
  update: { id: U, patch: { name: "y" } },
  delete: { id: U },
  workflow: { id: U },
  run: { id: U },
  upload: { name: "a.txt", type: "text/plain", base64: "aGk=" },
  ai: { prompt: "Summarize", system: "Be brief" },
};
// Checked after reading the record (object unknown before execution).
const open = ["record", "timeline", "user"];

for (const [method, args] of Object.entries(calls))
  test(`sdk: ${method} validated and permissioned`, () => {
    const c = parseCall({ method, args });
    assert.equal(denied(all, c), null);
    if (open.includes(method)) assert.equal(denied(none, c), null);
    else assert.match(String(denied(none, c)), /not allowed/);
  });

test("sdk: all methods classified as read or write", () => {
  const known = [...READ_METHODS, ...WRITE_METHODS, "workflow"];
  assert.deepEqual(Object.keys(calls).sort(), known.sort());
});

test("sdk: invalid calls refused", () => {
  assert.throws(() => parseCall({ method: "eval", args: {} }), /Invalid/);
  assert.throws(
    () => parseCall({ method: "aggregate", args: { object: "deals" } }),
    /Invalid/,
  );
  assert.throws(
    () => parseCall({ method: "run", args: { id: "x" } }),
    /Invalid/,
  );
  assert.throws(
    () => parseCall({ method: "query", args: { object: "a", x: 1 } }),
    /Invalid/,
  );
  // General cap, except upload (dedicated cap).
  const big = "a".repeat(70_000);
  assert.throws(
    () => parseCall({ method: "create", args: { object: "d", data: { big } } }),
    /too large/,
  );
  assert.equal(
    parseCall({ method: "upload", args: { name: "f", base64: big } }).method,
    "upload",
  );
  // Undeclared workflow: refused even if others are declared.
  const other = parseCall({
    method: "workflow",
    args: { id: "00000000-0000-4000-8000-000000000002" },
  });
  assert.match(String(denied(all, other)), /workflow not allowed/);
});

test("sdk: ai refused without a declared ai permission", () => {
  const c = parseCall({ method: "ai", args: { prompt: "hi" } });
  assert.equal(
    denied({ ...all, ai: {} }, c),
    "ai not allowed (permissions.ai declares no AI config)",
  );
  // Named config: valid name accepted, invalid one refused by the shape.
  assert.equal(
    denied(all, parseCall({ method: "ai", args: { prompt: "hi", name: "summary" } })),
    null,
  );
  assert.throws(() =>
    parseCall({ method: "ai", args: { prompt: "hi", name: "bad name!" } }),
  );
  assert.throws(() => permissionsSchema.parse({ ai: true }));
  assert.throws(() => permissionsSchema.parse({ ai: { default: { provider: "nope" } } }));
  assert.throws(
    () => parseCall({ method: "ai", args: { prompt: "" } }),
    /Invalid/,
  );
});
