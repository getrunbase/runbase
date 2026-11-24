import { test } from "node:test";
import assert from "node:assert/strict";
import {
  byDay,
  formFields,
  initialValues,
  monthGrid,
  recordSchema,
  shown,
  typedValues,
} from "./form";

const schema = [
  { key: "name", label: "Name", type: "text", required: true, minLength: 2 },
  { key: "email", label: "Email", type: "email" },
  { key: "amount", label: "Amount", type: "currency", min: 0 },
  { key: "stage", label: "Stage", type: "select", options: ["new", "won"], required: true },
  { key: "tags", label: "Tags", type: "multi_select", options: ["a", "b"] },
  { key: "vip", label: "VIP", type: "bool" },
  { key: "since", label: "Since", type: "date" },
  { key: "company", label: "Company", type: "ref", object: "companies", required: true },
  { key: "files", label: "Files", type: "file" },
  { key: "score", label: "Score", type: "formula" },
];
const fields = formFields(schema);
const companies = { company: ["c1", "c2"] };
const valid = {
  name: " Ada ",
  email: "",
  amount: "12.5",
  stage: "new",
  tags: ["a", "b"],
  vip: false,
  since: "2026-02-03",
  company: "c1",
};

test("formFields: include orders, exclude removes, non-editable types dropped", () => {
  assert.deepEqual(
    fields.map((f) => f.key),
    ["name", "email", "amount", "stage", "tags", "vip", "since", "company"],
  );
  assert.deepEqual(formFields(schema, [], ["email", "company"]).map((f) => f.key), [
    "name",
    "amount",
    "stage",
    "tags",
    "vip",
    "since",
  ]);
  assert.deepEqual(formFields(schema, ["company", "name", "files", "nope"]).map((f) => f.key), ["company", "name"]);
  assert.deepEqual(formFields("{{x}}"), []);
});

test("initialValues: record values by type", () => {
  const v = initialValues(fields, {
    data: { name: "Ada", amount: 12, tags: ["a"], vip: true, since: "2026-01-02T10:00:00Z" },
  });
  assert.deepEqual(v, {
    name: "Ada",
    email: "",
    amount: "12",
    stage: "",
    tags: ["a"],
    vip: true,
    since: "2026-01-02",
    company: "",
  });
});

test("recordSchema: valid values -> typed values", () => {
  const r = recordSchema(fields, { options: companies }).safeParse(valid);
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data, {
    name: "Ada",
    email: null,
    amount: 12.5,
    stage: "new",
    tags: ["a", "b"],
    vip: false,
    since: "2026-02-03",
    company: "c1",
  });
});

const errors = (values: Record<string, unknown>) => {
  const r = recordSchema(fields, { options: companies }).safeParse({ ...valid, ...values });
  return Object.fromEntries((r.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));
};

test("recordSchema: required fields", () => {
  assert.deepEqual(errors({ name: " ", stage: "", company: "" }), {
    name: "Required",
    stage: "Required",
    company: "Required",
  });
});

test("recordSchema: select limited to its options", () => {
  assert.deepEqual(errors({ stage: "lost", tags: ["a", "z"] }), {
    stage: "Unknown value",
    tags: "Unknown value",
  });
});

test("recordSchema: relation limited to records of the target object", () => {
  assert.deepEqual(errors({ company: "c9" }), { company: "Unknown value" });
  // Without known options: only presence is checked.
  assert.ok(recordSchema(fields).safeParse({ ...valid, company: "c9" }).success);
});

test("recordSchema: schema rules (length, e-mail, bounds, number) and translated messages", () => {
  assert.deepEqual(errors({ name: "A", email: "x", amount: "-1" }), {
    name: "At least 2 characters",
    email: "Invalid email address",
    amount: "Must be at least 0",
  });
  assert.deepEqual(errors({ amount: "abc" }), { amount: "Must be a number" });
  const fr = recordSchema(fields, { t: (k, v) => `fr.${k}${v?.min ?? ""}` });
  const r = fr.safeParse({ ...valid, name: "A" });
  assert.equal(r.error?.issues[0]?.message, "fr.minLength2");
});

test("typedValues: numbers, booleans, arrays, empty = null", () => {
  assert.deepEqual(typedValues(fields, { amount: "", tags: "a,b", vip: "true" }), {
    amount: null,
    tags: ["a", "b"],
    vip: true,
  });
});

test("shown: conditional fields", () => {
  assert.equal(shown({ field: "k", eq: "pro" }, { k: "pro" }), true);
  assert.equal(shown({ field: "k", neq: "pro" }, { k: "pro" }), false);
  assert.equal(shown({ field: "k", in: ["a", "b"] }, { k: "b" }), true);
  assert.equal(shown({ field: "k", filled: true }, { k: false }), false);
  assert.equal(shown(undefined, {}), true);
});

test("calendar: month grid (Monday first) and rows per day", () => {
  const g = monthGrid(2026, 1);
  assert.equal(g[0]![0], "2026-01-26");
  assert.ok(g.flat().includes("2026-02-28"));
  assert.ok(g.every((w) => w.length === 7));
  const d = byDay([{ at: "2026-02-03" }, { at: "2026-02-03T10:00:00" }, { at: "" }], (r) => r.at);
  assert.deepEqual([...d.keys()], ["2026-02-03"]);
  assert.equal(d.get("2026-02-03")!.length, 2);
});
