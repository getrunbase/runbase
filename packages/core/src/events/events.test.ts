// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { type TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { eventsService } from "./index";

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

test("an inserted event shows up in the timeline, in chronological order", async () => {
  const ctx = await owner("Evt");
  const obj = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  const { record } = await recordsService.upsert(ctx, {
    objectId: obj.id,
    data: { name: "Acme" },
  });
  const at = (s: string) => new Date(`2026-01-0${s}T00:00:00Z`);
  await eventsService.insert(ctx, {
    recordId: record.id,
    type: "b",
    occurredAt: at("3"),
    source: "test",
  });
  await eventsService.insert(ctx, {
    recordId: record.id,
    type: "a",
    occurredAt: at("1"),
    payload: { x: 1 },
  });
  await eventsService.insert(ctx, { type: "orphan" });

  // record.created: automatic creation event (records).
  const tl = (await eventsService.timeline(ctx, record.id)).filter(
    (e) => e.type !== "record.created",
  );
  assert.deepEqual(
    tl.map((e) => e.type),
    ["a", "b"],
  );
  assert.deepEqual(tl[0]!.payload, { x: 1 });

  const other = await owner("Evt2");
  assert.deepEqual(await eventsService.timeline(other, record.id), []);
  await assert.rejects(
    eventsService.insert(other, { recordId: record.id, type: "x" }),
  );
});

test("funnel: distinct records per event type, in the requested order", async () => {
  const ctx = await owner("Funnel");
  const obj = await objectsService.create(ctx, {
    slug: "users",
    name: "Users",
    fields: [{ key: "email", label: "Email", type: "email" }],
  });
  const ids = [];
  for (const email of ["a@x.io", "b@x.io"]) {
    const { record } = await recordsService.upsert(ctx, {
      objectId: obj.id,
      data: { email },
    });
    ids.push(record.id);
    await eventsService.insert(ctx, { recordId: record.id, type: "signup" });
  }
  // Two onboardings of the same record: counted once.
  for (let i = 0; i < 2; i++)
    await eventsService.insert(ctx, {
      recordId: ids[0],
      type: "onboarding_completed",
    });
  assert.deepEqual(
    await eventsService.funnel(ctx, [
      "signup",
      "onboarding_completed",
      "subscribed",
    ]),
    [
      { type: "signup", count: 2 },
      { type: "onboarding_completed", count: 1 },
      { type: "subscribed", count: 0 },
    ],
  );
  assert.deepEqual(await eventsService.types(ctx), [
    "onboarding_completed",
    "signup",
  ]);
});

test("list: filter by type and date, paginated newest to oldest", async () => {
  const ctx = await owner("EvtList");
  const at = (d: number) => new Date(Date.UTC(2026, 0, d));
  for (const d of [1, 2, 3, 4])
    await eventsService.insert(ctx, { type: "paid", occurredAt: at(d) });
  await eventsService.insert(ctx, { type: "other", occurredAt: at(5) });
  const p1 = await eventsService.list(ctx, {
    type: "paid",
    from: at(2),
    limit: 2,
  });
  assert.deepEqual(
    p1.items.map((e) => e.occurredAt.getUTCDate()),
    [4, 3],
  );
  const p2 = await eventsService.list(ctx, {
    type: "paid",
    from: at(2),
    limit: 2,
    cursor: p1.nextCursor!,
  });
  assert.deepEqual(
    p2.items.map((e) => e.occurredAt.getUTCDate()),
    [2],
  );
  assert.equal(p2.nextCursor, null);
  const other = await owner("EvtList2");
  assert.deepEqual((await eventsService.list(other)).items, []);
  // Malformed cursor: first page.
  assert.equal(
    (await eventsService.list(ctx, { cursor: "x" })).items.length,
    5,
  );
});
