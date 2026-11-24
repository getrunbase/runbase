import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyComputed,
  baseType,
  coerceValues,
  fieldsSchema,
  recordValidator,
  withDefaults,
  type Field,
} from "./fields";

test("form: multiselect CSV -> array, empty required text refused", () => {
  const fields: Field[] = [
    { key: "code", label: "Code", type: "text", required: true },
    { key: "m", label: "M", type: "multi_select", options: ["card", "paypal"] },
    { key: "b", label: "B", type: "bool" },
  ];
  const data = coerceValues(fields, { code: "", m: "card,paypal", b: "false" });
  assert.deepEqual(data, { code: "", m: ["card", "paypal"], b: false });
  assert.equal(recordValidator(fields).safeParse(data).success, false);
  assert.ok(recordValidator(fields).safeParse({ ...data, code: "FR" }).success);
});

test("per-field validation: pattern, length, bounds, rating, phone", () => {
  const fields: Field[] = [
    { key: "code", label: "Code", type: "text", pattern: "^[A-Z]{2}$" },
    { key: "bio", label: "Bio", type: "text", maxLength: 5 },
    { key: "age", label: "Age", type: "number", min: 0, max: 130 },
    { key: "note", label: "Note", type: "rating", scale: 5 },
    { key: "tel", label: "Phone", type: "phone" },
    { key: "mail", label: "Mail", type: "email", maxLength: 10 },
  ];
  const ok = (d: object) => recordValidator(fields).safeParse(d).success;
  assert.ok(ok({ code: "FR", bio: "abc", age: 30, note: 4, tel: "+33 6 12" }));
  assert.ok(!ok({ code: "fr" }));
  assert.ok(!ok({ bio: "trop long" }));
  assert.ok(!ok({ age: -1 }));
  assert.ok(!ok({ note: 6 }));
  assert.ok(!ok({ note: 2.5 }));
  assert.ok(!ok({ tel: "abc" }));
  assert.ok(!ok({ mail: "longue@adresse.fr" }));
  assert.ok(
    !fieldsSchema.safeParse([
      { key: "x", label: "X", type: "text", pattern: "(" },
    ]).success,
  );
});

test("defaults and computed fields: input ignored, formulas evaluated", () => {
  const fields: Field[] = [
    { key: "price", label: "Price", type: "currency", default: 0 },
    { key: "qte", label: "Qty", type: "number", default: 1 },
    { key: "total", label: "Total", type: "formula", formula: "price * qte" },
    { key: "cree", label: "Created", type: "created_at" },
    { key: "par", label: "Par", type: "created_by" },
  ];
  const input = coerceValues(fields, { price: "12", total: 999, cree: "x" });
  assert.deepEqual(input, { price: 12 });
  const out = applyComputed(fields, withDefaults(fields, input), {
    created: { at: "2026-01-01T00:00:00.000Z", by: "u1" },
  });
  assert.deepEqual(out, {
    price: 12,
    qte: 1,
    total: 12,
    cree: "2026-01-01T00:00:00.000Z",
    par: "u1",
  });
  assert.equal(baseType(fields[0]!), "number");
  assert.equal(baseType(fields[2]!), "text");
});
