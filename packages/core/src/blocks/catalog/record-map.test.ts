// Integration test: requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Worker } from "bullmq";
import { queueOptions } from "../../bus";
import { databasesService } from "../../databases";
import { objectsService } from "../../objects";
import { recordsService } from "../../records";
import { processStep, runsQueue, runsService, RUNS_QUEUE } from "../../runs";
import type { TenantContext } from "../../tenant";
import { workflowsService } from "../../workflows";

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

test("record.map: a Lead becomes linked Contact + Company", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("Map");
  await databasesService.create(ctx, {
    slug: "prospection",
    name: "Prospection",
  });
  await databasesService.create(ctx, { slug: "crm", name: "CRM" });
  const lead = await objectsService.create(ctx, {
    slug: "lead",
    name: "Lead",
    database: "prospection",
    fields: [
      { key: "nom", label: "Name", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "company_name", label: "Company name", type: "text" },
    ],
  });
  const company = await objectsService.create(ctx, {
    slug: "company",
    name: "Entreprise",
    database: "crm",
    fields: [{ key: "nom", label: "Name", type: "text" }],
  });
  const contact = await objectsService.create(ctx, {
    slug: "contact",
    name: "Contact",
    database: "crm",
    fields: [
      { key: "nom", label: "Name", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "source", label: "Source", type: "text" },
      {
        key: "company",
        label: "Entreprise",
        type: "ref",
        object: "company",
      },
    ],
  });
  const { record } = await recordsService.upsert(ctx, {
    objectId: lead.id,
    data: { nom: "Ada", email: "ada@acme.io", company_name: "Acme" },
  });
  const definition = {
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "company",
        type: "record.map",
        input: {
          source: "{{record.id}}",
          sourceObject: "lead",
          object: "company",
          mode: "upsert",
          key: "nom",
          mapping: { nom: { path: "company_name" } },
        },
      },
      {
        id: "contact",
        type: "record.map",
        input: {
          source: "{{record.id}}",
          sourceObject: "lead",
          object: "contact",
          mode: "create",
          mapping: {
            nom: { path: "nom" },
            email: { path: "email" },
            source: { value: "Lead {{record.data.nom}}" },
            company: { value: "{{steps.company.output.record.id}}" },
          },
        },
      },
    ],
    next: { company: { ok: ["contact"] } },
  };

  // Validation against the source and target schemas.
  const bad = structuredClone(definition);
  bad.steps[1]!.input.mapping = {
    inconnu: { path: "nom" },
    nom: { path: "absent" },
    email: { value: "pas-un-email" },
  } as never;
  const errors = await workflowsService.validate(ctx, bad);
  assert.deepEqual(errors, [
    "contact: mapping.inconnu: unknown target field",
    "contact: mapping.nom: unknown source path absent",
    "contact: mapping.email: invalid value",
  ]);
  assert.deepEqual(await workflowsService.validate(ctx, definition), []);

  // Dry run: simulated, nothing is written.
  const [dry] = await workflowsService.dryRun(ctx, definition, [record.id]);
  assert.ok(dry!.path.every((p) => p.simulated));
  assert.equal((await recordsService.search(ctx, contact.id)).length, 0);

  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
  });
  const wf = await workflowsService.create(ctx, { name: "Lead", definition });
  const run = await runsService.start(ctx, wf.id, { recordId: record.id });
  let done;
  for (let i = 0; i < 100; i++) {
    done = await runsService.get(ctx, run!.id);
    if (done!.status !== "running") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await worker.close();
  assert.equal(done!.status, "succeeded", JSON.stringify(done!.steps));

  const [ent] = await recordsService.search(ctx, company.id);
  const [ct] = await recordsService.search(ctx, contact.id);
  assert.equal(ent!.data.nom, "Acme");
  assert.deepEqual(ct!.data, {
    nom: "Ada",
    email: "ada@acme.io",
    source: "Lead Ada",
    company: ent!.id,
  });
  // Relation path read from the Contact: contact -> company.nom.
  const fiche = await recordsService.get(ctx, ct!.id, {
    include: ["company"],
  });
  assert.equal(
    (fiche.included.company as unknown as { data: { nom: string } }).data
      .nom,
    "Acme",
  );
});
