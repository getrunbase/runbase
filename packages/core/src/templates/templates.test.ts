// runbase-template.json format: validator (unit) and round trip
// export -> import -> export (integration, requires DATABASE_URL).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { AppError } from "../errors/app-error";
import { type TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { viewsService } from "../views";
import { functionsService } from "../functions";
import { workflowsService } from "../workflows";
import { pagesService } from "../pages";
import { secretsService } from "../secrets";
import { webhooksService } from "../webhooks";
import { parseTemplate, templatesService } from "./index";
import { rewrite } from "./format";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function owner(name: string): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, ${name}, ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

const SRC = `import { useQuery } from "@runbase/sdk";
export default function List({ object }: { object: string }) {
  const { data } = useQuery({ object });
  return <ul>{data.map((r: any) => <li key={r.id}>{r.data.name}</li>)}</ul>;
}`;
const minimal = { format: "runbase-template", version: 1, name: "T" };

test("validator: minimal template, default values", () => {
  const t = parseTemplate(minimal);
  assert.deepEqual(t.objects, []);
  assert.deepEqual(t.secrets, []);
  assert.deepEqual(parseTemplate(JSON.stringify(minimal)).name, "T");
});

test("validator: readable errors through appError (code, items, paths)", () => {
  const bad = {
    ...minimal,
    version: 2,
    objects: [
      {
        slug: "a",
        name: "A",
        fields: [{ key: "x", label: "X", type: "nope" }],
      },
      { slug: "a", name: "A bis", fields: [] },
    ],
    views: [{ object: "ghost", name: "V" }],
    secrets: ["bad name"],
  };
  try {
    parseTemplate(bad);
    assert.fail("must fail");
  } catch (e) {
    assert.ok(e instanceof AppError);
    assert.equal(e.code, "templates.invalid");
    assert.equal(e.kind, "invalid_input");
    const paths = e.items.map((i) => String(i.params.path));
    for (const p of ["version", "objects.0.fields.0.type", "secrets.0"])
      assert.ok(paths.includes(p), `${p} absent de ${paths}`);
    assert.ok(e.items.every((i) => i.code === "templates.issue"));
    assert.match(e.message, /^Invalid template \(\d+ error\(s\)\)/);
  }
  // Internal consistency (duplicates, unknown objects), on a well-formed template.
  assert.throws(
    () =>
      parseTemplate({
        ...minimal,
        objects: [
          { slug: "a", name: "A", fields: [] },
          { slug: "a", name: "A bis", fields: [] },
        ],
        views: [{ object: "ghost", name: "V" }],
      }),
    (e) =>
      e instanceof AppError &&
      ["objects.1", "views.0.object"].every((p) =>
        e.items.some((i) => i.params.path === p),
      ),
  );
  assert.throws(
    () => parseTemplate("{nope"),
    (e) => e instanceof AppError && e.code === "templates.invalidJson",
  );
});

test("rewrite: keys and values, nested strings", () => {
  const map = new Map([["abc", "$object:x"]]);
  assert.deepEqual(rewrite({ abc: ["abc", "{{abc}}", 1] }, map), {
    "$object:x": ["$object:x", "{{$object:x}}", 1],
  });
});

test("export -> import -> export round trip identical except ids", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const src = await owner("TplSrc");
  const company = await objectsService.create(src, {
    slug: "company",
    name: "Company",
    fields: [{ key: "name", label: "Name", type: "text", title: true }],
  });
  const contact = await objectsService.create(src, {
    slug: "contact",
    name: "Contact",
    fields: [
      { key: "email", label: "Email", type: "email", unique: true },
      { key: "company", label: "Company", type: "ref", object: "company" },
      { key: "n", label: "N", type: "autonumber" },
    ],
  });
  // Relation cycle: company -> contact -> company.
  await objectsService.update(src, company.id, {
    fields: [
      { key: "name", label: "Name", type: "text", title: true },
      { key: "contacts", label: "Contacts", type: "refs", object: "contact" },
    ],
  });
  const acme = await recordsService.upsert(src, {
    objectId: company.id,
    data: { name: "Acme" },
  });
  const ann = await recordsService.upsert(src, {
    objectId: contact.id,
    externalId: "ann",
    data: { email: "ann@acme.io", company: acme.record.id },
  });
  await recordsService.update(src, acme.record.id, {
    contacts: [ann.record.id],
  });
  await viewsService.save(src, contact.id, {
    name: "Acme",
    filter: { field: "email", op: "contains", value: "acme" },
    sort: [{ field: "email", dir: "asc" }],
  });
  await secretsService.set(src, "CRM_TOKEN", "super-secret-value-123");
  await functionsService.save(src, {
    name: "ping",
    code: "export default async () => ({ ok: true })",
    permissions: { domains: ["api.example.com"], secrets: ["CRM_TOKEN"] },
  });
  // Secrets referenced outside functions: `{{secret.X}}` block and webhook.
  await webhooksService.create(src, {
    name: "stripe-in",
    eventType: "stripe.event",
    secretName: "STRIPE_SIGNING",
    config: { format: "stripe" },
  });
  await workflowsService.create(src, {
    name: "Notify",
    definition: {
      trigger: { type: "trigger.webhook", webhook: "stripe-in" },
      steps: [
        {
          id: "slack",
          type: "slack.send",
          input: { webhookUrl: "{{secret.SLACK_WEBHOOK}}", text: "paid" },
        },
      ],
    },
  });
  const child = await workflowsService.create(src, {
    name: "Child",
    definition: { trigger: { type: "trigger.manual" }, steps: [] },
  });
  await workflowsService.create(src, {
    name: "Parent",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        { id: "run", type: "workflow.run", input: { workflow: child.id } },
      ],
    },
  });
  await pagesService.create(src, {
    name: "Contacts",
    files: { "index.tsx": SRC, "lib/util.ts": "export const x = 1;" },
    permissions: { objects: [contact.id], workflows: [child.id] },
    publish: true,
  });

  const first = await templatesService.export(src, {
    name: "CRM",
    sampleRecords: 10,
  });
  const text = JSON.stringify(first);
  assert.ok(!text.includes("super-secret-value-123"), "valeur de secret");
  assert.deepEqual(first.secrets, [
    "CRM_TOKEN",
    "SLACK_WEBHOOK",
    "STRIPE_SIGNING",
  ]);
  for (const id of [src.workspaceId, contact.id, child.id, acme.record.id])
    assert.ok(!text.includes(id), `id ${id} exported`);
  assert.equal(first.records.length, 2);
  assert.ok(!("n" in first.records.find((r) => r.object === "contact")!.data));
  // The exported template is valid.
  parseTemplate(text);

  const dst = await owner("TplDst");
  const res = await templatesService.import(dst, text);
  assert.deepEqual(res.missingSecrets, [
    "CRM_TOKEN",
    "SLACK_WEBHOOK",
    "STRIPE_SIGNING",
  ]);
  assert.equal(res.workflows.length, 3);
  // Webhooks are not part of the format: recreated by hand (new URL).
  await webhooksService.create(dst, {
    name: "stripe-in",
    eventType: "stripe.event",
    secretName: "STRIPE_SIGNING",
    config: { format: "stripe" },
  });
  const second = await templatesService.export(dst, {
    name: "CRM",
    sampleRecords: 10,
  });
  assert.deepEqual(second, first);

  // Conflict: a second import into the same workspace is refused.
  await assert.rejects(
    templatesService.import(dst, text),
    (e) => e instanceof AppError && e.code === "templates.conflict",
  );
});
