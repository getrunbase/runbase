// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { databasesService } from "../databases";
import { objectsService } from "../objects";
import { overviewService } from "../overview";
import type { TenantContext } from "../tenant";
import { MAX_NOTES_PER_ENTITY, notesService } from "./index";

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

async function setup(name: string) {
  const ctx = await owner(name);
  await databasesService.create(ctx, { slug: "crm", name: "CRM" });
  const deal = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    database: "crm",
    fields: [{ key: "amount", label: "Amount", type: "number" }],
  });
  return { ctx, deal };
}

test("notes: save, upsert by title, list without body, get, delete", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const { ctx, deal } = await setup("Notes");

  const a = await notesService.save(ctx, {
    entity: { type: "object", ref: "deal" },
    title: "Amounts",
    body: "Amounts are in cents.",
  });
  assert.equal(a.entity.id, deal.id);
  assert.equal(a.stale, false);
  // Same title on the same entity: updated, not duplicated.
  const b = await notesService.save(ctx, {
    entity: { type: "object", ref: deal.id },
    title: "Amounts",
    body: "Amounts are in euros.",
  });
  assert.equal(b.id, a.id);
  await notesService.save(ctx, {
    entity: { type: "workspace" },
    title: "Keys",
    body: "snake_case English keys.",
  });

  const all = await notesService.list(ctx);
  assert.equal(all.length, 2);
  assert.ok(all.every((n) => !("body" in n)));
  const forDeal = await notesService.list(ctx, {
    entity: { type: "object", ref: "deal" },
  });
  assert.deepEqual(
    forDeal.map((n) => n.title),
    ["Amounts"],
  );
  assert.equal(
    (await notesService.get(ctx, a.id)).body,
    "Amounts are in euros.",
  );

  // Another workspace never sees them.
  const other = await owner("Other");
  assert.deepEqual(await notesService.list(other), []);
  await assert.rejects(notesService.get(other, a.id), /Note not found/);

  await notesService.remove(ctx, a.id);
  await assert.rejects(notesService.get(ctx, a.id), /Note not found/);
  await assert.rejects(notesService.remove(ctx, a.id), /Note not found/);
  await assert.rejects(notesService.get(ctx, "nope"), /Note not found/);
});

test("notes: stale when the entity moves on, fresh again after save", async () => {
  const { ctx, deal } = await setup("Stale");
  const n = await notesService.save(ctx, {
    entity: { type: "object", ref: "deal" },
    title: "Why",
    body: "Owner field removed on purpose.",
  });
  await objectsService.update(ctx, deal.id, {
    fields: [
      { key: "amount", label: "Amount", type: "number" },
      { key: "stage", label: "Stage", type: "text" },
    ],
  });
  assert.equal((await notesService.get(ctx, n.id)).stale, true);
  const again = await notesService.save(ctx, {
    entity: { type: "object", ref: "deal" },
    title: "Why",
    body: "Still true.",
  });
  assert.equal(again.stale, false);
  // A workspace note never goes stale.
  const w = await notesService.save(ctx, {
    entity: { type: "workspace" },
    title: "Lang",
    body: "English.",
  });
  assert.equal(w.stale, false);
});

test("notes: unknown entity, invalid input and per-entity cap", async () => {
  const { ctx } = await setup("Cap");
  await assert.rejects(
    notesService.save(ctx, {
      entity: { type: "workflow", ref: "missing" },
      title: "x",
      body: "y",
    }),
    /workflow not found: missing/,
  );
  await assert.rejects(
    notesService.save(ctx, {
      entity: { type: "workspace" },
      title: " ",
      body: "y",
    }),
  );
  for (let i = 0; i < MAX_NOTES_PER_ENTITY; i++)
    await notesService.save(ctx, {
      entity: { type: "object", ref: "deal" },
      title: `n${i}`,
      body: "b",
    });
  await assert.rejects(
    notesService.save(ctx, {
      entity: { type: "object", ref: "deal" },
      title: "one too many",
      body: "b",
    }),
    /Note limit reached/,
  );
  // Updating an existing title still works at the cap.
  await notesService.save(ctx, {
    entity: { type: "object", ref: "deal" },
    title: "n0",
    body: "updated",
  });
});

test("workspace.describe: note titles per entity, no body", async () => {
  const { ctx, deal } = await setup("Describe");
  await notesService.save(ctx, {
    entity: { type: "object", ref: "deal" },
    title: "Amounts",
    body: "In cents.",
  });
  await notesService.save(ctx, {
    entity: { type: "workspace" },
    title: "Keys",
    body: "snake_case.",
  });
  const d = await overviewService.describe(ctx);
  const obj = d.databases[0]!.objects.find((o) => o.id === deal.id)!;
  assert.deepEqual(
    obj.notes.map((n) => n.title),
    ["Amounts"],
  );
  assert.deepEqual(
    d.notes.map((n) => n.title),
    ["Keys"],
  );
  assert.doesNotMatch(JSON.stringify(d), /In cents/);
});
