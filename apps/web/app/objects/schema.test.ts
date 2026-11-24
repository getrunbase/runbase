import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldsSchema } from "@getrunbase/core/objects";
import { slugify, toField, toRow } from "./schema";

test("slugify derives a valid key", () => {
  assert.equal(slugify("Prix du cornet (€)"), "prix_du_cornet");
  assert.equal(slugify("Sauce préférée"), "sauce_preferee");
});

test("friteries base: rows -> valid schema, stable round trip", () => {
  const fields = [
    { key: "", label: "Nom", type: "text", options: "" },
    { key: "", label: "Ville", type: "text", options: "" },
    { key: "", label: "Note", type: "number", options: "" },
    {
      key: "",
      label: "Sauce",
      type: "select",
      options: "Andalouse, Samouraï ,Mayo",
    },
    { key: "", label: "Ouverte", type: "bool", options: "" },
  ].map((r) => toField(r as Parameters<typeof toField>[0]));
  const parsed = fieldsSchema.parse(fields);
  assert.deepEqual(parsed[3], {
    key: "sauce",
    label: "Sauce",
    type: "select",
    options: ["Andalouse", "Samouraï", "Mayo"],
  });
  // Renaming keeps the key.
  const renamed = toField({ ...toRow(parsed[0]!), label: "Enseigne" });
  assert.equal(renamed.key, "nom");
});

test("ref / refs keep the target object, other types lose it", () => {
  const ref = toField({
    key: "",
    label: "Entreprise",
    type: "ref",
    options: "",
    object: "companies",
  });
  assert.deepEqual(fieldsSchema.parse([ref])[0], {
    key: "entreprise",
    label: "Entreprise",
    type: "ref",
    object: "companies",
  });
  const back = toField({ ...toRow(ref), type: "text" });
  assert.equal("object" in back, false);
});

test("advanced settings: formula and validation kept, empty ones removed", () => {
  const f = toField({
    key: "",
    label: "Total",
    type: "formula",
    options: "",
    config: { formula: "prix * qte", result: "number", pattern: "" },
  });
  assert.deepEqual(fieldsSchema.parse([f])[0], {
    key: "total",
    label: "Total",
    type: "formula",
    formula: "prix * qte",
    result: "number",
  });
  const row = toRow({
    key: "age",
    label: "Âge",
    type: "number",
    min: 0,
    required: true,
  });
  assert.deepEqual(row.config, { min: 0, required: true });
  assert.deepEqual(toField(row), {
    key: "age",
    label: "Âge",
    type: "number",
    min: 0,
    required: true,
  });
});
