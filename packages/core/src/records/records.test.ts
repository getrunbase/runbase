// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { type TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { changedFields, recordsService } from "./index";
import { busQueue } from "../bus";

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

test("changedFields: additions, deletions, deep values", () => {
  assert.deepEqual(
    changedFields(
      { a: 1, b: [1], c: { x: 1 } },
      { a: 1, b: [2], d: 3, c: { x: 1 } },
    ),
    ["b", "d"],
  );
});

test("upsert by external_id: a single record, merge, replace, validation", async () => {
  const ctx = await owner("Rec");
  const obj = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "size", label: "Taille", type: "number" },
      { key: "web", label: "Site", type: "url" },
    ],
  });
  const up = (data: Record<string, unknown>, mode?: "merge" | "replace") =>
    recordsService.upsert(ctx, {
      objectId: obj.id,
      externalId: "ext-1",
      data,
      mode,
    });

  const a = await up({ name: "Acme", size: 10 });
  assert.equal(a.created, true);
  assert.deepEqual(a.changed, ["name", "size"]);

  const b = await up({ size: 12, web: "https://acme.io" });
  assert.equal(b.created, false);
  assert.equal(b.record.id, a.record.id);
  assert.deepEqual(b.changed, ["size", "web"]);
  assert.deepEqual(b.record.data, {
    name: "Acme",
    size: 12,
    web: "https://acme.io",
  });

  const c = await up({ name: "Acme", size: 12, web: "https://acme.io" });
  assert.deepEqual(c.changed, []);

  const d = await up({ name: "Acme 2" }, "replace");
  assert.deepEqual(d.changed, ["name", "size", "web"]);
  assert.deepEqual(d.record.data, { name: "Acme 2" });

  await assert.rejects(up({ size: "x" }));
  await assert.rejects(up({ size: 1 }, "replace")); // name required

  const [row] =
    await sql`select count(*)::int n from records where object_id = ${obj.id}`;
  assert.equal(row!.n, 1);
});

test("a record mutation produces exactly one job on the bus", async () => {
  const ctx = await owner("Bus");
  const obj = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const up = (name: string) =>
    recordsService.upsert(ctx, {
      objectId: obj.id,
      externalId: "bus-1",
      data: { name },
    });
  const jobsFor = async (id: string) =>
    (
      await busQueue().getJobs([
        "waiting",
        "prioritized",
        "delayed",
        "active",
        "completed",
      ])
    )
      .filter((j) => j?.data.id === id)
      .map((j) => j.name);

  const a = await up("A");
  assert.deepEqual(await jobsFor(a.record.id), ["record.created"]);
  await up("B");
  assert.deepEqual((await jobsFor(a.record.id)).sort(), [
    "record.created",
    "record.updated",
  ]);
  await up("B"); // no change: no job
  assert.equal((await jobsFor(a.record.id)).length, 2);
});

test("concurrent upserts on the same external_id: 1 record, no error", async () => {
  const ctx = await owner("RecConc");
  const obj = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "size", label: "Taille", type: "number" },
    ],
  });
  const res = await Promise.all(
    [1, 2, 3].map((size) =>
      recordsService.upsert(ctx, {
        objectId: obj.id,
        externalId: "same",
        data: { name: "Acme", size },
        backfill: true,
      }),
    ),
  );
  assert.equal(res.filter((r) => r.created).length, 1);
  const [c] =
    await sql`select count(*)::int n from records where object_id = ${obj.id}`;
  assert.equal(c!.n, 1);
});

test("remove: audit and record.deleted; object deletion publishes each record", async () => {
  const ctx = await owner("RecDel");
  const obj = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const mk = (externalId: string) =>
    recordsService
      .upsert(ctx, {
        objectId: obj.id,
        externalId,
        data: { name: externalId },
        backfill: true,
      })
      .then((r) => r.record.id);
  const [a, b, c] = [await mk("a"), await mk("b"), await mk("c")];
  const deletedJobs = async () =>
    (
      await busQueue().getJobs([
        "waiting",
        "prioritized",
        "active",
        "completed",
        "failed",
      ])
    )
      .filter(
        (j) =>
          j?.name === "record.deleted" &&
          j.data.workspaceId === ctx.workspaceId,
      )
      .map((j) => j.data.id)
      .sort();

  assert.equal((await recordsService.remove(ctx, a))?.id, a);
  assert.equal(await recordsService.remove(ctx, a), null);
  const [log] =
    await sql`select count(*)::int n from audit_log where action = 'record.delete' and resource_id = ${a}`;
  assert.equal(log!.n, 1);
  assert.deepEqual(await deletedJobs(), [a]);

  await objectsService.remove(ctx, obj.id, { confirm: true });
  assert.deepEqual(await deletedJobs(), [a, b, c].sort());
});

test("atomic upsertBatch: an invalid item in the middle writes no record", async () => {
  const ctx = await owner("Batch");
  const obj = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [{ key: "name", label: "Name", type: "text", required: true }],
  });
  await assert.rejects(
    recordsService.upsertBatch(ctx, obj.id, [
      { externalId: "b-1", data: { name: "A" } },
      { externalId: "b-2", data: { name: 42 } },
      { externalId: "b-3", data: { name: "C" } },
    ]),
  );
  const [row] =
    await sql`select count(*)::int as n from records where object_id = ${obj.id}`;
  assert.equal(row!.n, 0);

  const ok = await recordsService.upsertBatch(ctx, obj.id, [
    { externalId: "b-1", data: { name: "A" } },
    { externalId: "b-3", data: { name: "C" } },
  ]);
  assert.deepEqual(
    ok.map((r) => r.created),
    [true, true],
  );
});

test("timeline: create and update create events with diff", async () => {
  const { eventsService } = await import("../events");
  const ctx = await owner("Tl");
  const obj = await objectsService.create(ctx, {
    slug: "tl",
    name: "Tl",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "A" },
  });
  await recordsService.update(ctx, record.id, { name: "B" });
  await recordsService.update(ctx, record.id, { name: "B" }); // no change
  const tl = await eventsService.timeline(ctx, record.id);
  assert.deepEqual(
    tl.map((e) => [e.type, e.payload]),
    [
      ["record.created", { changes: { name: { from: null, to: "A" } } }],
      ["record.updated", { changes: { name: { from: "A", to: "B" } } }],
    ],
  );
});
