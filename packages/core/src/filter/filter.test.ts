// DSL unit tests: interpreter, validation, parameterized SQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { records } from "../db/schema";
import type { Field } from "../objects/fields";
import {
  compileFilter,
  evaluateFilter,
  validateFilter,
  operatorsDoc,
  type Filter,
} from "./index";
import { AppError } from "../errors/app-error";

const fields: Field[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "size", label: "Taille", type: "number" },
  { key: "active", label: "Active", type: "bool" },
  { key: "since", label: "Since", type: "date" },
  { key: "tier", label: "Tier", type: "select", options: ["a", "b"] },
  { key: "company", label: "Company", type: "ref", object: "company" },
];
const refs = {
  self: "lead",
  objects: {
    company: {
      id: "00000000-0000-0000-0000-000000000001",
      fields: [{ key: "size", label: "Taille", type: "number" }] as Field[],
    },
  },
};
const now = new Date("2026-06-01T00:00:00Z");
const data = {
  name: "Acme Corp",
  size: 42,
  active: true,
  since: "2026-05-20",
  tier: "b",
  empty: "",
};
const ev = (f: Filter) => evaluateFilter(fields, f, data, now);

const cases: [Filter, boolean][] = [
  [{ field: "name", op: "eq", value: "Acme Corp" }, true],
  [{ field: "name", op: "eq", value: "Acme" }, false],
  [{ field: "name", op: "contains", value: "CORP" }, true],
  [{ field: "name", op: "contains", value: "zzz" }, false],
  [{ field: "name", op: "starts_with", value: "acme" }, true],
  [{ field: "name", op: "starts_with", value: "corp" }, false],
  [{ field: "name", op: "is_empty" }, false],
  [{ field: "size", op: "eq", value: 42 }, true],
  [{ field: "size", op: "gt", value: 42 }, false],
  [{ field: "size", op: "gte", value: 42 }, true],
  [{ field: "size", op: "lt", value: 50 }, true],
  [{ field: "size", op: "lte", value: 41 }, false],
  [{ field: "size", op: "between", value: [40, 45] }, true],
  [{ field: "size", op: "between", value: [43, 45] }, false],
  [{ field: "since", op: "before", value: "2026-05-21" }, true],
  [{ field: "since", op: "after", value: "2026-05-21" }, false],
  [{ field: "since", op: "older_than", value: 7 }, true],
  [{ field: "since", op: "older_than", value: 30 }, false],
  [{ field: "since", op: "within", value: 30 }, true],
  [{ field: "since", op: "within", value: 7 }, false],
  [{ field: "tier", op: "eq", value: "b" }, true],
  [{ field: "tier", op: "in", value: ["a"] }, false],
  [{ field: "tier", op: "in", value: ["a", "b"] }, true],
  [{ field: "active", op: "is", value: true }, true],
  [{ field: "active", op: "is", value: false }, false],
  [
    {
      all: [
        { field: "active", op: "is", value: true },
        {
          any: [
            { field: "size", op: "gt", value: 100 },
            { field: "tier", op: "eq", value: "b" },
          ],
        },
      ],
    },
    true,
  ],
  [{ any: [] }, false],
];

test("each operator evaluated in memory", () => {
  for (const [f, expected] of cases)
    assert.equal(ev(f), expected, JSON.stringify(f));
  assert.equal(
    evaluateFilter(fields, { field: "name", op: "is_empty" }, {}),
    true,
  );
});

test("each operator compiles to parameterized SQL", () => {
  for (const [f] of [
    ...cases,
    [{ field: "company.size", op: "gt", value: 100 }] as [Filter],
  ]) {
    const q = new PgDialect().sqlToQuery(
      compileFilter(records.data, fields, f, refs),
    );
    assert.ok(q.sql.length > 0);
  }
});

test("rejection: unknown fields and incompatible types", () => {
  const bad: unknown[] = [
    { field: "nope", op: "eq", value: 1 },
    { field: "company.nope", op: "eq", value: 1 },
    { field: "name.x", op: "eq", value: "a" },
    { field: "name", op: "gt", value: "a" },
    { field: "size", op: "contains", value: "4" },
    { field: "size", op: "eq", value: "42" },
    { field: "size", op: "between", value: [1] },
    { field: "since", op: "before", value: "yesterday" },
    { field: "since", op: "within", value: -3 },
    { field: "tier", op: "eq", value: "z" },
    { field: "tier", op: "gt", value: "a" },
    { field: "active", op: "is", value: "true" },
    { field: "active", op: "contains", value: true },
    { field: "name", op: "regex", value: "(" },
    {
      all: [
        { field: "size", op: "eq", value: 1 },
        { field: "x", op: "eq", value: 1 },
      ],
    },
    { field: "name", op: "eq", value: "a", code: "process.exit()" },
  ];
  for (const f of bad) {
    assert.throws(() => validateFilter(fields, f, refs), JSON.stringify(f));
    assert.throws(() => evaluateFilter(fields, f, data));
  }
});

test("injection has no effect: values and keys never concatenated", () => {
  const evil = "x'); drop table records; --";
  const q = new PgDialect().sqlToQuery(
    compileFilter(records.data, fields, {
      any: [
        { field: "name", op: "starts_with", value: evil },
        { field: "name", op: "contains", value: evil },
      ],
    }),
  );
  assert.ok(!q.sql.includes(evil));
  assert.ok(q.params.includes(evil));
  assert.throws(() =>
    compileFilter(records.data, fields, { field: evil, op: "eq", value: 1 }),
  );
  // Value evaluated as data, never executed.
  assert.equal(
    ev({ field: "name", op: "eq", value: "${process.exit(1)}" }),
    false,
  );
});

test("filter on the system id column (in, eq)", () => {
  const a = "7f3c1a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
  const q = new PgDialect().sqlToQuery(
    compileFilter(records.data, fields, { field: "id", op: "in", value: [a] }),
  );
  assert.match(q.sql, /"records"\."id"::text in \(\$1::text\)/);
  assert.deepEqual(q.params, [a]);
  assert.doesNotThrow(() =>
    validateFilter(fields, { field: "id", op: "eq", value: a }),
  );
});

test("not_in, ends_with, regex operators: interpreter and SQL", () => {
  assert.equal(ev({ field: "tier", op: "not_in", value: ["a"] }), true);
  assert.equal(ev({ field: "tier", op: "not_in", value: ["b"] }), false);
  assert.equal(ev({ field: "name", op: "ends_with", value: "corp" }), true);
  assert.equal(ev({ field: "name", op: "regex", value: "^Ac.e" }), true);
  assert.equal(ev({ field: "name", op: "regex", value: "^corp" }), false);
  assert.throws(() =>
    validateFilter(fields, { field: "name", op: "regex", value: "(" }),
  );
  assert.throws(() =>
    validateFilter(fields, { field: "size", op: "ends_with", value: "2" }),
  );
  const q = new PgDialect().sqlToQuery(
    compileFilter(records.data, fields, {
      all: [
        { field: "name", op: "regex", value: "^A" },
        { field: "size", op: "not_in", value: [1, 2] },
      ],
    }),
  );
  assert.match(q.sql, / ~ \$/);
  assert.match(q.sql, /not in/);
});

test("between on a date field takes an ISO tuple", () => {
  const f: Filter = {
    field: "since",
    op: "between",
    value: ["2026-05-01", "2026-05-31"],
  };
  assert.doesNotThrow(() => validateFilter(fields, f));
  assert.equal(ev(f), true);
  assert.equal(
    ev({ field: "since", op: "between", value: ["2026-04-01", "2026-04-30"] }),
    false,
  );
  assert.throws(() =>
    validateFilter(fields, { field: "since", op: "between", value: [1, 2] }),
  );
  assert.match(operatorsDoc, /date\/datetime: [^;]*between/);
});

test("invalid regex names the pattern and the dialect, kind invalid_input", () => {
  try {
    validateFilter(fields, { field: "name", op: "regex", value: "(" });
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof AppError);
    assert.equal(e.code, "filter.invalidRegex");
    assert.equal(e.kind, "invalid_input");
    assert.match(e.message, /"\("/);
    assert.match(e.message, /POSIX/);
  }
});
