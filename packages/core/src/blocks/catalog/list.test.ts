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

test("list: contacts of a company, email filter, map, update loop", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  await runsQueue().obliterate({ force: true });
  const ctx = await owner("List");
  await databasesService.create(ctx, { slug: "crm", name: "CRM" });
  const entreprise = await objectsService.create(ctx, {
    slug: "entreprise",
    name: "Company",
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
      { key: "statut", label: "Status", type: "text" },
      {
        key: "entreprise",
        label: "Company",
        type: "ref",
        object: "entreprise",
      },
    ],
  });
  const { record: acme } = await recordsService.upsert(ctx, {
    objectId: entreprise.id,
    data: { nom: "Acme" },
  });
  const add = (data: Record<string, unknown>) =>
    recordsService.upsert(ctx, {
      objectId: contact.id,
      data: { ...data, entreprise: acme.id },
    });
  const { record: ada } = await add({ nom: "Ada", email: "ada@acme.io" });
  const { record: bob } = await add({ nom: "Bob" });

  const definition = {
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "ent",
        type: "record.get",
        input: { id: "{{record.id}}", include: ["contact"] },
      },
      {
        id: "withEmail",
        type: "list.filter",
        input: {
          object: "contact",
          items: "{{steps.ent.output.record.included.contact}}",
          condition: { field: "email", op: "is_not_empty" },
        },
      },
      {
        id: "names",
        type: "list.map",
        input: {
          items: "{{steps.withEmail.output.items}}",
          mapping: {
            nom: { path: "nom" },
            company_name: { path: "entreprise.nom" },
            rang: { value: "#{{index}} {{item.data.nom}}" },
          },
        },
      },
      {
        id: "boucle",
        type: "loop",
        input: {
          items: "{{steps.withEmail.output.items}}",
          include: ["entreprise"],
          do: [
            {
              id: "maj",
              type: "record.update",
              input: {
                recordId: "{{item.id}}",
                data: {
                  statut: "Client {{item.included.entreprise.data.nom}}",
                },
              },
            },
          ],
        },
      },
    ],
    next: {
      ent: { found: ["withEmail"], not_found: ["withEmail"] },
      withEmail: { ok: ["names"] },
      names: { ok: ["boucle"] },
    },
  };
  const bad = structuredClone(definition);
  bad.steps[1]!.input.condition = {
    field: "absent",
    op: "is_not_empty",
  } as never;
  assert.deepEqual(await workflowsService.validate(ctx, bad), [
    "withEmail: Unknown field: absent",
  ]);
  assert.deepEqual(await workflowsService.validate(ctx, definition), []);

  const worker = new Worker(RUNS_QUEUE, processStep, {
    ...queueOptions(),
  });
  const wf = await workflowsService.create(ctx, { name: "List", definition });
  const run = await runsService.start(ctx, wf.id, { recordId: acme.id });
  let done;
  for (let i = 0; i < 100; i++) {
    done = await runsService.get(ctx, run!.id);
    if (done!.status !== "running") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await worker.close();
  assert.equal(done!.status, "succeeded", JSON.stringify(done!.steps));
  const names = done!.steps.find((s) => s.stepId === "names") as unknown as {
    output: { items: unknown[] };
  };
  assert.deepEqual(names.output.items, [
    { nom: "Ada", company_name: "Acme", rang: "#0 Ada" },
  ]);
  assert.equal(
    (await recordsService.get(ctx, ada.id)).data.statut,
    "Client Acme",
  );
  assert.equal((await recordsService.get(ctx, bob.id)).data.statut, undefined);
});
