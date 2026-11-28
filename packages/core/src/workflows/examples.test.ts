// Reference workflows (workflows.examples) checked against the real schemas
// and the rules of workflows.guide. No database.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { blocks } from "../blocks";
import { functionInputSchema } from "../functions";
import { fieldSchema } from "../objects/fields";
import { paths } from "../runs/templates";
import { triggerSchema } from "../triggers/schema";
import { webhookConfigSchema } from "../webhooks";
import { WORKFLOW_EXAMPLES } from "./examples";
import { WORKFLOWS_GUIDE } from "./guide";
import { definitionSchema } from "./index";
import { normalizeGraph } from "./graph";
import { stepOptionsSchema } from "./step-options";
import { at, isTemplate, type Step } from "./validate-shared";

// Importing bus/db opens connections that keep the process alive.
after(() => setImmediate(() => process.exit(0)));

const snake = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

test("between 2 and 3 examples, all listed in the guide", () => {
  assert.ok(WORKFLOW_EXAMPLES.length >= 2 && WORKFLOW_EXAMPLES.length <= 3);
  for (const ex of WORKFLOW_EXAMPLES)
    assert.ok(WORKFLOWS_GUIDE.includes(ex.name), ex.name);
});

for (const ex of WORKFLOW_EXAMPLES)
  test(`example ${ex.name} follows the schemas and the guide`, () => {
    for (const o of ex.objects) {
      assert.match(o.slug, snake);
      for (const f of o.fields) {
        const parsed = fieldSchema.parse(f);
        assert.match(parsed.key, snake);
        if ("options" in parsed)
          for (const opt of parsed.options) assert.match(opt, snake, opt);
      }
    }
    for (const w of ex.webhooks) {
      webhookConfigSchema.parse(w.config);
      assert.ok(ex.secrets.includes(w.secretName), w.secretName);
    }

    const fns = new Map(
      ex.functions.map((f) => [f.name, functionInputSchema.parse(f)]),
    );
    for (const f of fns.values()) {
      assert.ok(!f.permissions.domains.includes("*"), `${f.name}: domains *`);
      const out = f.outputSchema as { properties?: object };
      assert.ok(Object.keys(out.properties ?? {}).length, `${f.name}: output`);
      for (const s of f.permissions.secrets)
        assert.ok(ex.secrets.includes(s), `${f.name}: secret ${s}`);
      assert.ok(
        (f.limits.timeoutMs ?? Infinity) <= 10000,
        `${f.name}: under 10 s`,
      );
      assert.doesNotMatch(f.code, /simulat|dry_?run|mock/i, f.name);
    }

    const def = definitionSchema.parse(ex.workflow.definition);
    const trigger = triggerSchema.parse(def.trigger);
    const object =
      "object" in trigger && trigger.object
        ? ex.objects.find((o) => o.slug === trigger.object)
        : undefined;
    if ("object" in trigger && trigger.object)
      assert.ok(object, "trigger object");
    if (trigger.type === "trigger.webhook")
      assert.ok(ex.webhooks.some((w) => w.name === trigger.webhook));

    const steps = def.steps as Step[];
    const ids = new Set(steps.map((s) => s.id));
    // Not a single-function workflow: native steps around the functions.
    assert.ok(
      steps.some((s) => !s.type.startsWith("fn.")),
      "native steps",
    );
    for (const s of steps) {
      assert.match(s.id, snake);
      stepOptionsSchema.parse(s);
      const input = (s.input ?? {}) as Record<string, unknown>;
      if (s.type.startsWith("fn.")) {
        const f = fns.get(s.type.slice(3));
        assert.ok(f, `${s.id}: unknown function ${s.type}`);
        for (const r of (f.inputSchema as { required?: string[] }).required ??
          [])
          assert.ok(r in input, `${s.id}: missing ${r}`);
      } else {
        const block = blocks[s.type];
        assert.ok(block, `${s.id}: unknown block ${s.type}`);
        const parsed = block.inputSchema.safeParse(input);
        if (!parsed.success)
          for (const i of parsed.error.issues)
            assert.ok(isTemplate(at(input, i.path)), `${s.id}: ${i.message}`);
      }
      for (const p of paths(input)) {
        const [root, id, out, field] = p.split(".");
        if (root === "record") {
          if (id !== "id")
            assert.ok(
              object?.fields.some((f) => f.key === id),
              `${s.id}: {{${p}}}`,
            );
        } else if (root === "steps") {
          const target = steps.find((x) => x.id === id);
          assert.ok(target, `${s.id}: {{${p}}}`);
          assert.equal(out, "output");
          const f = target.type.startsWith("fn.")
            ? fns.get(target.type.slice(3))
            : undefined;
          if (f)
            assert.ok(
              field! in
                ((f.outputSchema as { properties?: object }).properties ?? {}),
              `${s.id}: {{${p}}}`,
            );
        } else assert.fail(`${s.id}: unexpected variable {{${p}}}`);
      }
    }
    const { entry, next } = normalizeGraph(def);
    assert.ok(entry.length);
    for (const [from, branches] of Object.entries(next)) {
      assert.ok(ids.has(from), from);
      for (const targets of Object.values(branches))
        for (const t of targets) assert.ok(ids.has(t), `${from} -> ${t}`);
    }
  });
