// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { withTenant, type TenantContext } from "../tenant";
import { workflowVersions } from "../db/schema";
import { workflowsService as wf } from "./index";

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

const def = (n: number) => ({
  trigger: { type: "trigger.manual" },
  steps: [{ id: "s1", type: "wait", input: { duration: `${n}s` } }],
});

test("editing creates a version, restoring takes back an old one", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("A");
  const b = await owner("B");

  const w = await wf.create(a, { name: "Follow-up", definition: def(1) });
  assert.equal(w.status, "draft");
  assert.equal(w.currentVersion, 1);

  const u = await wf.update(a, w.id, { definition: def(2), status: "active" });
  assert.equal(u!.currentVersion, 2);
  assert.equal(u!.status, "active");
  assert.deepEqual((await wf.get(a, w.id))!.definition, def(2));

  // Without a new definition: no new version.
  assert.equal((await wf.update(a, w.id, { name: "R2" }))!.currentVersion, 2);

  const r = await wf.restore(a, w.id, 1);
  assert.equal(r!.currentVersion, 3);
  assert.deepEqual((await wf.get(a, w.id))!.definition, def(1));
  const vs = await wf.versions(a, w.id);
  assert.deepEqual(
    vs.map((v) => v.version),
    [1, 2, 3],
  );
  assert.deepEqual(vs[1]!.definition, def(2)); // v2 intacte

  // Versions immuables.
  await assert.rejects(
    withTenant(a, (tx) => tx.update(workflowVersions).set({ definition: {} })),
  );
  await assert.rejects(wf.create(a, { name: "x", definition: {} as never }));

  // Isolation.
  assert.equal((await wf.list(b)).length, 0);
  assert.equal(await wf.get(b, w.id), null);
  assert.equal(await wf.restore(b, w.id, 1), null);
  assert.equal(await wf.restore(a, w.id, 99), null);
});

test("condition: validated against the object schema and evaluated", async () => {
  const { objectsService } = await import("../objects");
  const { recordsService } = await import("../records");
  const { blocks, blockContext } = await import("../blocks");
  const a = await owner("Cond");
  const co = await objectsService.create(a, {
    slug: "company",
    name: "Company",
    fields: [{ key: "size", label: "Taille", type: "number" }],
  });
  const ct = await objectsService.create(a, {
    slug: "contact",
    name: "Contact",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "company", label: "Company", type: "ref", object: "company" },
    ],
  });
  const step = (condition: unknown) => ({
    trigger: { type: "trigger.manual" },
    steps: [
      {
        id: "c",
        type: "condition",
        input: { object: "contact", recordId: "{{record.id}}", condition },
      },
    ],
  });
  for (const bad of [
    { field: "nope", op: "eq", value: 1 },
    { field: "company.size", op: "contains", value: "x" },
    { field: "name", op: "gt", value: 3 },
  ])
    await assert.rejects(wf.create(a, { name: "KO", definition: step(bad) }));
  const good = { all: [{ field: "company.size", op: "gt", value: 100 }] };
  const w = await wf.create(a, { name: "OK", definition: step(good) });
  await assert.rejects(
    wf.update(a, w.id, {
      definition: step({ field: "x", op: "eq", value: 1 }),
    }),
  );

  const big = await recordsService.upsert(a, {
    objectId: co.id,
    data: { size: 500 },
  });
  const c = await recordsService.upsert(a, {
    objectId: ct.id,
    data: { name: "Ann", company: big.record.id },
  });
  const run = (condition: unknown) =>
    blocks.condition!.run(
      { object: "contact", recordId: c.record.id, condition },
      blockContext(a),
    );
  assert.equal((await run(good)).branch, "true");
  assert.equal(
    (await run({ field: "company.size", op: "lt", value: 100 })).branch,
    "false",
  );
});
