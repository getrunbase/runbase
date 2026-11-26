import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blocksService } from "@getrunbase/core/blocks";
import { allowed } from "@getrunbase/core/filter";
import {
  addEntry,
  addStep,
  entryOf,
  removeEntry,
  branchesOf,
  connect,
  fieldAt,
  lastAiConfig,
  disconnect,
  formFields,
  layout,
  parseValue,
  removeStep,
  setInput,
  type Definition,
} from "./graph";

const onboarding = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/lead-qualification.json",
      import.meta.url,
    ),
    "utf8",
  ),
).definition as Definition;

// Replays the editor actions: adding steps, entering inputs through
// the generated form fields, linking branches.
test("the lead qualification workflow is built with the editor operations", async () => {
  const blocks = await blocksService.list();
  let def: Definition = { trigger: { type: "trigger.manual" }, steps: [] };
  def = { ...def, trigger: onboarding.trigger };
  const ids: Record<string, string> = {};
  for (const s of onboarding.steps) {
    def = addStep(def, s.type);
    const created = def.steps.at(-1)!;
    ids[s.id] = created.id;
    const block = blocks.find((b) => b.type === s.type)!;
    const keys = formFields(block.inputSchema).map((f) => f.key);
    for (const k of Object.keys(s.input ?? {}))
      assert.ok(keys.includes(k), `${s.type}.${k} absent du formulaire`);
    def = setInput(def, created.id, s.input ?? {});
  }
  for (const [src, out] of Object.entries(onboarding.next ?? {}))
    for (const [branch, target] of Object.entries(out)) {
      const step = def.steps.find((x) => x.id === ids[src])!;
      const block = blocks.find((b) => b.type === step.type);
      assert.ok(branchesOf(step, block).includes(branch), `${src}.${branch}`);
      for (const t of [target].flat())
        def = connect(def, ids[src]!, branch, ids[t]!);
    }
  const rename = (d: Definition) =>
    JSON.stringify(d).replace(/"([a-z_.]+_\d+)"/g, (m, id) => {
      const orig = Object.entries(ids).find(([, v]) => v === id)?.[0];
      return orig ? `"${orig}"` : m;
    });
  assert.deepEqual(JSON.parse(rename(def)), onboarding);
  const pos = layout(def);
  assert.equal(Object.keys(pos).length, def.steps.length + 1);
});

test("formFields derives controls from the JSON Schema", async () => {
  const blocks = await blocksService.list();
  const kinds = (t: string) =>
    Object.fromEntries(
      formFields(blocks.find((b) => b.type === t)!.inputSchema).map((f) => [
        f.key,
        f.kind,
      ]),
    );
  assert.deepEqual(kinds("ai.decide").branches, "list");
  assert.deepEqual(kinds("ai.decide").prompt, "text");
  assert.equal(kinds("ai.decide").model, undefined);
  assert.deepEqual(kinds("http.request").method, "enum");
});

test("condition builder: operators by type and typed values", () => {
  assert.ok(allowed.number.includes("gt"));
  assert.ok(!allowed.text.includes("gt"));
  assert.equal(parseValue({ type: "number" }, "gt", "50"), 50);
  assert.deepEqual(parseValue({ type: "number" }, "between", "1, 5"), [1, 5]);
  assert.deepEqual(parseValue({ type: "select" }, "in", "a, b"), ["a", "b"]);
  assert.equal(parseValue({ type: "bool" }, "is", "true"), true);
  assert.equal(parseValue({ type: "date" }, "within", "7"), 7);
  assert.equal(parseValue({ type: "text" }, "is_empty", "x"), undefined);
});

test("removeStep and disconnect clean up next", () => {
  let def: Definition = { trigger: { type: "trigger.manual" }, steps: [] };
  def = addStep(addStep(def, "wait"), "wait");
  def = connect(def, "wait_1", "done", "wait_2");
  assert.deepEqual(disconnect(def, "wait_1", "done").next, {});
  assert.deepEqual(removeStep(def, "wait_2").next, { wait_1: {} });
});

test("several targets per branch and several entries", () => {
  let def: Definition = { trigger: { type: "trigger.manual" }, steps: [] };
  def = addStep(addStep(addStep(def, "wait"), "wait"), "wait");
  // One more link adds a target; targets are always a list.
  def = connect(def, "wait_1", "done", "wait_2");
  assert.deepEqual(def.next, { wait_1: { done: ["wait_2"] } });
  def = connect(def, "wait_1", "done", "wait_3");
  def = connect(def, "wait_1", "done", "wait_3");
  assert.deepEqual(def.next, { wait_1: { done: ["wait_2", "wait_3"] } });
  // Delete on a link removes only its target.
  assert.deepEqual(disconnect(def, "wait_1", "done", "wait_2").next, {
    wait_1: { done: ["wait_3"] },
  });
  assert.deepEqual(removeStep(def, "wait_3").next, {
    wait_1: { done: ["wait_2"] },
  });
  // Entries: the first by default, then add / remove via the trigger.
  assert.deepEqual(entryOf(def), ["wait_1"]);
  def = addEntry(def, "wait_2");
  assert.deepEqual(def.entry, ["wait_1", "wait_2"]);
  assert.deepEqual(removeEntry(def, "wait_1").entry, ["wait_2"]);
  assert.deepEqual(removeStep(def, "wait_2").entry, ["wait_1"]);
  // Layout: both entries side by side on the same layer.
  const pos = layout(def);
  assert.equal(pos.wait_1!.y, pos.wait_2!.y);
  assert.notEqual(pos.wait_1!.x, pos.wait_2!.x);
});

test("fieldAt follows relations: deal.contact.entreprise.taille", () => {
  const db = { slug: "crm", name: "CRM" };
  const objects = [
    {
      slug: "deal",
      name: "Deal",
      database: db,
      fields: [
        {
          key: "contact",
          label: "Contact",
          type: "ref" as const,
          object: "contact",
        },
      ],
    },
    {
      slug: "contact",
      name: "Contact",
      database: db,
      fields: [
        {
          key: "entreprise",
          label: "Entreprise",
          type: "ref" as const,
          object: "entreprise",
        },
      ],
    },
    {
      slug: "entreprise",
      name: "Entreprise",
      database: db,
      fields: [{ key: "taille", label: "Taille", type: "number" as const }],
    },
  ];
  const r = fieldAt(objects, "deal", "contact.entreprise.taille");
  assert.equal(r?.field.type, "number");
  assert.deepEqual(r?.labels, ["Contact", "Entreprise", "Taille"]);
  assert.equal(fieldAt(objects, "deal", "contact.inconnu"), undefined);
});

test("lastAiConfig: config of the last configured AI step", () => {
  const ai = { provider: "anthropic", model: "claude-haiku-5-5", secret: "K" };
  const def: Definition = {
    trigger: {},
    steps: [
      { id: "a", type: "ai.decide", input: { ai: { provider: "openai" } } },
      { id: "b", type: "ai.run", input: { ai } },
      { id: "c", type: "ai.extract", input: {} },
      { id: "d", type: "record.update", input: { ai: { provider: "x" } } },
    ],
  };
  assert.deepEqual(lastAiConfig(def), ai);
  assert.equal(lastAiConfig({ trigger: {}, steps: [{ id: "c", type: "ai.run" }] }), undefined);
});
