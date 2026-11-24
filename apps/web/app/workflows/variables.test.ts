import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field } from "@getrunbase/core/objects/fields";
import { branchesOf, branchName, type ObjectInfo } from "./graph";
import {
  casesFromOptions,
  constantValue,
  dataToMapping,
  fieldDefault,
  mappingToData,
  parseTemplate,
  scopeFor,
  setField,
  templateLabel,
  toTemplate,
  varLabel,
  varObject,
  varWords,
  TRIGGER_RECORD,
} from "./variables";
import { testT } from "./test-t";

const db = { slug: "crm", name: "CRM" };
const obj = (slug: string, name: string, fields: Field[]): ObjectInfo => ({
  slug,
  name,
  database: db,
  fields,
});
const objects = [
  obj("entreprises", "Entreprises", [
    { key: "nom", label: "Nom", type: "text", title: true },
    { key: "taille", label: "Taille", type: "number" },
  ]),
  obj("contacts", "Contacts", [
    { key: "nom", label: "Nom", type: "text" },
    {
      key: "entreprise",
      label: "Entreprise",
      type: "ref",
      object: "entreprises",
    },
  ]),
  obj("deals", "Deals", [
    { key: "nom", label: "Nom", type: "text" },
    {
      key: "stage",
      label: "Stage",
      type: "select",
      options: ["nouveau", "gagné", "perdu"],
    },
    { key: "note", label: "Note", type: "text" },
    { key: "contact", label: "Contact", type: "ref", object: "contacts" },
  ]),
];
const blocks = [
  {
    type: "ai.decide",
    label: "Décision IA",
    description: "",
    branches: [],
    inputSchema: {},
    outputSchema: {
      properties: { branch: {}, reason: {}, confidence: {} },
    },
  },
  {
    type: "record.update",
    label: "Modifier une fiche",
    description: "",
    branches: ["ok"],
    inputSchema: {},
    outputSchema: { properties: { record: {}, changed: {} } },
  },
];
const def = {
  trigger: { type: "trigger.manual", object: "deals" },
  steps: [
    { id: "decide", type: "ai.decide", input: { branches: ["a", "b"] } },
    {
      id: "maj",
      type: "record.update",
      input: { recordId: "{{record.contact}}", data: {} },
    },
    { id: "fin", type: "wait", input: {} },
    { id: "ailleurs", type: "wait", input: {} },
  ],
  next: { decide: { a: ["maj"], b: ["ailleurs"] }, maj: { ok: ["fin"] } },
};
const scope = scopeFor(def, blocks, objects, "deals", "fin", varWords(testT()));

test("pill <-> template: relation paths, round trip", () => {
  const t = "{{record.contact.entreprise.nom}}";
  assert.deepEqual(parseTemplate(t), [
    { path: "record.contact.entreprise.nom" },
  ]);
  assert.equal(toTemplate(parseTemplate(t)), t);
  assert.equal(
    varLabel("record.contact.entreprise.nom", scope),
    "Contact › Entreprise › Nom",
  );
  assert.equal(varLabel("record.id", scope), "Deal en cours");
  assert.equal(varObject("record.contact", scope), "contacts");
  assert.equal(varObject("record.id", scope), "deals");
});

test("pill <-> template: step outputs on the same path", () => {
  // `ailleurs` is on the other branch: its outputs are not offered.
  assert.deepEqual(
    scope.steps.map((s) => s.id),
    ["decide", "maj"],
  );
  assert.equal(
    varLabel("steps.decide.output.reason", scope),
    "Étape Décision IA › raison",
  );
  // The updated record is a Contact (record linked to the deal): fields expanded.
  assert.equal(
    varLabel("steps.maj.output.record.entreprise.nom", scope),
    "Étape Modifier une fiche › fiche › Entreprise › Nom",
  );
  const t = "{{steps.decide.output.reason}}";
  assert.equal(toTemplate(parseTemplate(t)), t);
});

test("pill <-> template: mixed text, spaces tolerated", () => {
  const t = "Deal {{ record.nom }} pour {{record.contact.entreprise.nom}} !";
  const segs = parseTemplate(t);
  assert.deepEqual(segs, [
    { text: "Deal " },
    { path: "record.nom" },
    { text: " pour " },
    { path: "record.contact.entreprise.nom" },
    { text: " !" },
  ]);
  assert.equal(
    toTemplate(segs),
    "Deal {{record.nom}} pour {{record.contact.entreprise.nom}} !",
  );
  assert.equal(
    templateLabel(t, scope),
    "Deal Nom pour Contact › Entreprise › Nom !",
  );
  assert.deepEqual(parseTemplate("sans variable"), [{ text: "sans variable" }]);
});

test("Update a record: the form produces the right input", () => {
  const deals = objects[2]!;
  const stage = deals.fields.find((f) => f.key === "stage")!;
  const note = deals.fields.find((f) => f.key === "note")!;
  // "+ Field" Stage (default value = first option), then "gagné".
  let data = setField({}, "stage", fieldDefault(stage));
  assert.deepEqual(data, { stage: "nouveau" });
  data = setField(data, "stage", "gagné");
  // Note: text + pill "Contact › Entreprise › Nom".
  data = setField(
    data,
    "note",
    constantValue(note, "Gagné chez {{record.contact.entreprise.nom}}"),
  );
  const input = { recordId: TRIGGER_RECORD, data };
  assert.deepEqual(input, {
    recordId: "{{record.id}}",
    data: {
      stage: "gagné",
      note: "Gagné chez {{record.contact.entreprise.nom}}",
    },
  });
  // Removing a row removes the key.
  assert.deepEqual(setField(data, "note", undefined), { stage: "gagné" });
  // Typed values.
  const taille = objects[0]!.fields[1]!;
  assert.equal(constantValue(taille, "120"), 120);
  assert.equal(constantValue(taille, "{{record.x}}"), "{{record.x}}");
});

test("record.map: mapping <-> form values", () => {
  const mapping = {
    nom: { path: "nom" },
    note: { value: "Lead {{record.nom}}" },
    taille: { value: 3 },
  };
  const data = mappingToData(mapping);
  assert.deepEqual(data, {
    nom: "{{source.nom}}",
    note: "Lead {{record.nom}}",
    taille: 3,
  });
  assert.deepEqual(dataToMapping(data), mapping);
});

test("Switch: one case per select option, branches and labels", () => {
  const cases = casesFromOptions(["nouveau", "gagné", "perdu"]);
  assert.deepEqual(cases, [
    { id: "c_nouveau", label: "nouveau", op: "eq", value: "nouveau" },
    { id: "c_gagne", label: "gagné", op: "eq", value: "gagné" },
    { id: "c_perdu", label: "perdu", op: "eq", value: "perdu" },
  ]);
  // Running again does not duplicate existing cases.
  assert.equal(casesFromOptions(["gagné", "autre"], cases).length, 4);
  const step = { id: "s", type: "switch", input: { cases } };
  assert.deepEqual(branchesOf(step), [
    "c_nouveau",
    "c_gagne",
    "c_perdu",
    "else",
  ]);
  assert.equal(branchName(step, "c_gagne", String), "gagné");
  assert.equal(
    branchName(step, "else", () => "Sinon"),
    "Sinon",
  );
});
