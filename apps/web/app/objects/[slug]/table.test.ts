import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFilter } from "@getrunbase/core/filter";
import type { Field } from "@getrunbase/core/objects";
import { opsFor, parseValue, pillsToFilter } from "./table";

const fields: Field[] = [
  { key: "nom", label: "Nom", type: "text" },
  { key: "note", label: "Note", type: "number" },
  { key: "ouvert", label: "Ouvert", type: "bool" },
  { key: "vu", label: "Vu", type: "date" },
  { key: "sauce", label: "Sauce", type: "select", options: ["andalouse"] },
];

test("pills -> valid filter DSL for the core", () => {
  const filter = pillsToFilter(fields, [
    { field: "nom", op: "contains", value: "fri" },
    { field: "note", op: "gte", value: "4" },
    { field: "ouvert", op: "is", value: "true" },
    { field: "vu", op: "within", value: "7" },
    { field: "sauce", op: "is_empty", value: "" },
    { field: "note", op: "lt", value: "abc" }, // incomplete: ignored
  ]);
  assert.deepEqual(filter, {
    all: [
      { field: "nom", op: "contains", value: "fri" },
      { field: "note", op: "gte", value: 4 },
      { field: "ouvert", op: "is", value: true },
      { field: "vu", op: "within", value: 7 },
      { field: "sauce", op: "is_empty" },
    ],
  });
  assert.doesNotThrow(() => validateFilter(fields, filter));
  assert.equal(pillsToFilter(fields, []), undefined);
});

test("every offered operator is accepted by the DSL", () => {
  for (const f of fields)
    for (const op of opsFor(f)) {
      const value =
        op === "within" || op === "older_than"
          ? 3
          : op.startsWith("is_")
            ? undefined
            : f.type === "date"
              ? "2026-01-01"
              : parseValue(f, f.type === "select" ? "andalouse" : "1", op);
      assert.doesNotThrow(
        () => validateFilter(fields, { field: f.key, op, value }),
        `${f.type} ${op}`,
      );
    }
});
