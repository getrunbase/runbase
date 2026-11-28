import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDependencyMap, dependenciesOf } from "./dependencies";

const f = (...keys: string[]) => keys.map((key) => ({ key }));
const objects = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "leads",
    fields: f("email", "status", "score", "company"),
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "companies",
    fields: f("domain", "name"),
  },
];

const map = buildDependencyMap({
  objects,
  workflows: [
    {
      id: "w1",
      name: "qualify",
      status: "active",
      definition: {
        trigger: {
          type: "trigger.record_updated",
          object: "leads",
          fields: ["score"],
        },
        steps: [
          {
            id: "enrich",
            type: "fn.enrich",
            input: { email: "{{record.email}}" },
          },
          {
            id: "each",
            type: "loop",
            input: {
              items: "{{steps.enrich.output.items}}",
              do: [
                {
                  id: "save",
                  type: "record.upsert",
                  input: {
                    object: "$object:companies",
                    match: "domain",
                    data: { domain: "{{item.d}}", name: "{{item.n}}" },
                  },
                },
              ],
            },
          },
          {
            id: "mark",
            type: "record.update",
            input: { recordId: "{{record.id}}", data: { status: "qualified" } },
          },
          {
            id: "ping",
            type: "http.request",
            input: { url: "https://hooks.example.com/x" },
          },
        ],
      },
    },
    {
      id: "w2",
      name: "import",
      definition: {
        trigger: {
          type: "trigger.webhook",
          webhook: "form",
          object: "leads",
          match: "email",
          mapping: { email: "payload.email" },
        },
        steps: [],
      },
    },
  ],
  functions: [
    {
      name: "enrich",
      code: `export default async ({ email }, { records }) => {
  const r = await fetch("https://api.clearbit.com/v1?e=" + email);
  const [lead] = await records.search("leads", { limit: 1 });
  await records.update(lead.id, { score: lead.company ? 10 : 1 });
};`,
      permissions: { domains: ["api.clearbit.com"], records: "write" },
    },
  ],
  pages: [
    {
      id: "p1",
      name: "Pipeline",
      files: {
        "index.tsx": `<Kanban object="leads" groupBy="status" subtitleField="company" />`,
      },
      permissions: { objects: ["leads"], write: ["leads"] },
    },
  ],
});

test("field writers and readers come from workflows, functions and pages", () => {
  assert.deepEqual(map.fields["leads.status"], {
    writers: ["page:Pipeline", "workflow:qualify#mark"],
    readers: ["page:Pipeline"],
  });
  assert.deepEqual(map.fields["leads.score"]!.writers, ["function:enrich"]);
  assert.ok(
    map.fields["leads.score"]!.readers.includes("workflow:qualify#trigger"),
  );
  assert.deepEqual(map.fields["leads.email"]!.writers, [
    "workflow:import#trigger",
  ]);
  assert.ok(
    map.fields["leads.email"]!.readers.includes("workflow:qualify#enrich"),
  );
  assert.deepEqual(map.fields["companies.name"]!.writers, [
    "workflow:qualify#save",
  ]);
  assert.ok(map.fields["leads.company"]!.readers.includes("function:enrich"));
});

test("workflow entry: trigger, nested steps, objects, functions, domains", () => {
  const w = map.workflows.find((x) => x.name === "qualify")!;
  assert.deepEqual(
    w.steps.map((s) => s.id),
    ["enrich", "each", "save", "mark", "ping"],
  );
  assert.deepEqual(w.functions, ["enrich"]);
  assert.deepEqual(w.domains, ["api.clearbit.com", "hooks.example.com"]);
  assert.deepEqual(w.objects.companies, {
    reads: ["domain"],
    writes: ["domain", "name"],
  });
  assert.deepEqual(w.objects.leads!.writes, ["status"]);
});

test("dependenciesOf answers one entity", () => {
  assert.deepEqual(dependenciesOf(map, "leads.status"), {
    field: "leads.status",
    writers: ["page:Pipeline", "workflow:qualify#mark"],
    readers: ["page:Pipeline"],
  });
  const obj = dependenciesOf(map, "leads") as { usedBy: string[] };
  assert.deepEqual(obj.usedBy, [
    "function:enrich",
    "page:Pipeline",
    "workflow:import",
    "workflow:qualify",
  ]);
  assert.equal(
    (dependenciesOf(map, "workflow:import") as { name: string }).name,
    "import",
  );
  assert.ok(dependenciesOf(map, "function:enrich"));
  assert.equal(dependenciesOf(map, "nope"), null);
  assert.equal(dependenciesOf(map, "workflow:nope"), null);
});
