// Integration test: requires DATABASE_URL and Redis.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { apiKeysService } from "../api-keys";
import { busQueue } from "../bus";
import { objectsService } from "../objects";
import { type TenantContext } from "../tenant";
import { ingest } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function setup() {
  const [org] =
    await sql`insert into organizations (name) values ('Ing') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'Ing', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx: TenantContext = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "size", label: "Taille", type: "number" },
    ],
  });
  const key = (scopes: ("read" | "write")[]) =>
    apiKeysService
      .create(ctx, { name: "k", scopes, workspaceIds: [ws!.id] })
      .then((k) => k.key);
  return {
    ws: ws!.id as string,
    write: await key(["write"]),
    read: await key(["read"]),
  };
}

test("ingestion: auth, 422, upsert + event, idempotency, batch", async () => {
  const { ws, write, read } = await setup();
  const call = (
    body: unknown,
    extra: Partial<Parameters<typeof ingest>[0]> = {},
  ) =>
    ingest({
      apiKey: write,
      workspaceId: ws,
      objectSlug: "company",
      body,
      ...extra,
    });

  assert.equal(
    (await call({ external_id: "a" }, { apiKey: null })).status,
    401,
  );
  assert.equal(
    (await call({ external_id: "a" }, { apiKey: read })).status,
    403,
  );
  assert.equal(
    (await call({ external_id: "a" }, { objectSlug: "nope" })).status,
    404,
  );

  const bad = await call({ data: "x" });
  assert.equal(bad.status, 422);
  const paths = (bad.body as { errors: { path: string }[] }).errors.map(
    (e) => e.path,
  );
  assert.deepEqual(paths.sort(), ["data", "external_id"]);
  const badData = await call({ external_id: "a", data: { size: "x" } });
  assert.equal(badData.status, 422);

  const body = {
    external_id: "acme",
    data: { name: "Acme", size: 10 },
    event: { type: "visit", payload: { page: "/" } },
  };
  const first = await call(body, { idempotencyKey: "k1" });
  assert.equal(first.status, 200);
  const r = first.body as {
    record_id: string;
    created: boolean;
    changed: string[];
    event_id: string;
  };
  assert.equal(r.created, true);
  assert.deepEqual(r.changed, ["name", "size"]);
  assert.ok(r.event_id);

  const replay = await call(body, { idempotencyKey: "k1" });
  assert.deepEqual(replay, first);
  const [cn] =
    await sql`select count(*)::int n from events where record_id = ${r.record_id} and type not like 'record.%'`;
  assert.equal(cn!.n, 1);
  const [cm] =
    await sql`select count(*)::int m from records where workspace_id = ${ws}`;
  assert.equal(cm!.m, 1);

  const upd = await call({ external_id: "acme", data: { size: 11 } });
  assert.deepEqual((upd.body as { changed: string[] }).changed, ["size"]);

  const tooMany = await call(
    {
      items: Array.from({ length: 1001 }, (_, i) => ({ external_id: `b${i}` })),
    },
    { batch: true },
  );
  assert.equal(tooMany.status, 422);
  const batch = await call(
    {
      items: [
        { external_id: "b1", data: { name: "B1" } },
        { external_id: "b2", data: {} },
      ],
    },
    { batch: true },
  );
  assert.equal(batch.status, 200);
  const results = (
    batch.body as { results: { created?: boolean; errors?: unknown }[] }
  ).results;
  assert.equal(results[0]!.created, true);
  assert.ok(results[1]!.errors);
});

// Bus jobs (all states) published for this workspace.
const busJobs = async (ws: string) =>
  (
    await busQueue().getJobs([
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "prioritized",
    ])
  ).filter((j) => j?.data.workspaceId === ws && j.name === "event.received")
    .length;

test("idempotency: concurrent requests, 1 event and 1 job; different body 422", async () => {
  const { ws, write } = await setup();
  const call = (body: unknown) =>
    ingest({
      apiKey: write,
      workspaceId: ws,
      objectSlug: "company",
      body,
      idempotencyKey: "conc",
    });
  const body = {
    external_id: "x",
    data: { name: "X" },
    event: { type: "visit" },
  };
  const res = await Promise.all([call(body), call(body)]);
  assert.ok(res.some((r) => r.status === 200));
  assert.ok(res.every((r) => r.status === 200 || r.status === 409));
  const [ev] =
    await sql`select count(*)::int n from events where workspace_id = ${ws} and type not like 'record.%'`;
  assert.equal(ev!.n, 1);
  assert.equal(await busJobs(ws), 1);
  assert.equal((await call({ ...body, data: { name: "Y" } })).status, 422);
});

test("transactional ingestion: event fails, no record", async () => {
  const { ws, write } = await setup();
  await assert.rejects(
    ingest({
      apiKey: write,
      workspaceId: ws,
      objectSlug: "company",
      // Valid date in JS, out of range for Postgres: the event insert fails.
      body: {
        external_id: "tx",
        data: { name: "Tx" },
        event: { type: "visit", occurred_at: "-100000-01-01T00:00:00Z" },
      },
    }),
  );
  const [c] =
    await sql`select count(*)::int n from records where workspace_id = ${ws}`;
  assert.equal(c!.n, 0);
});
