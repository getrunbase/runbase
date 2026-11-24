// Integration test: backfill and CSV import. Requires DATABASE_URL and Redis.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { apiKeysService } from "../api-keys";
import { busQueue } from "../bus";
import { objectsService } from "../objects";
import { type TenantContext } from "../tenant";
import { ingest } from "./index";
import { parseCsv } from "../records/csv";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

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
  ).filter((j) => j?.data.workspaceId === ws).length;

async function setup() {
  const [org] =
    await sql`insert into organizations (name) values ('Bf') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'Bf', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  const ctx: TenantContext = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  await objectsService.create(ctx, {
    slug: "customer",
    name: "Client",
    fields: [
      { key: "name", label: "Nom", type: "text", required: true },
      { key: "email", label: "Email", type: "email" },
      { key: "seats", label: "Seats", type: "number" },
    ],
  });
  const { key } = await apiKeysService.create(ctx, {
    name: "k",
    scopes: ["write"],
    workspaceIds: [ws!.id],
  });
  return { ws: ws!.id as string, key };
}

test("parseCsv: quotes, commas, CRLF", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, ""y""",2\n\n'), [
    ["a", "b"],
    ['x, "y"', "2"],
  ]);
});

test("backfill: records and events written, no job on the bus", async () => {
  const { ws, key } = await setup();
  const call = (body: unknown, extra = {}) =>
    ingest({
      apiKey: key,
      workspaceId: ws,
      objectSlug: "customer",
      body,
      ...extra,
    });

  const csv =
    'Client ID,Name,Mail,Seats,Ignored\nc1,"Acme, Inc",a@acme.io,3,x\nc2,Beta,,,y\n';
  const imp = await call(
    {
      csv,
      mapping: { Name: "name", Mail: "email", Seats: "seats" },
      external_id_column: "Client ID",
      backfill: true,
    },
    { csv: true },
  );
  assert.equal(imp.status, 200);
  const results = (imp.body as { results: { created: boolean }[] }).results;
  assert.deepEqual(
    results.map((r) => r.created),
    [true, true],
  );
  const [rec] =
    await sql`select data from records where workspace_id = ${ws} and external_id = 'c1'`;
  assert.deepEqual(rec!.data, {
    name: "Acme, Inc",
    email: "a@acme.io",
    seats: 3,
  });

  const single = await call({
    external_id: "c3",
    data: { name: "Gamma" },
    event: { type: "signup" },
    backfill: true,
  });
  assert.equal(single.status, 200);
  const batch = await call(
    { items: [{ external_id: "c4", data: { name: "D" } }], backfill: true },
    { batch: true },
  );
  assert.equal(batch.status, 200);
  const [ev] =
    await sql`select count(*)::int n from events where workspace_id = ${ws}`;
  assert.equal(ev!.n, 1);
  assert.equal(await busJobs(ws), 0);

  const missing = await call(
    { csv, mapping: {}, external_id_column: "nope" },
    { csv: true },
  );
  assert.equal(missing.status, 422);

  // Without backfill, ingestion does publish.
  await call({ external_id: "c5", data: { name: "E" } });
  assert.equal(await busJobs(ws), 1);
});

test("batch: per-item backfill flag honored", async () => {
  const { ws, key } = await setup();
  const res = await ingest({
    apiKey: key,
    workspaceId: ws,
    objectSlug: "customer",
    batch: true,
    body: {
      items: [
        { external_id: "p1", data: { name: "P1" }, backfill: true },
        { external_id: "p2", data: { name: "P2" } },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.equal(await busJobs(ws), 1);
});
