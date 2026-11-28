// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { type TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { queryService } from "./index";

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

async function seed(ctx: TenantContext, name: string) {
  const obj = await objectsService.create(ctx, {
    slug: "contacts",
    name: "Contacts",
    fields: [{ key: "name", label: "Name", type: "text" }],
  });
  await recordsService.upsert(ctx, {
    objectId: obj.id,
    externalId: "1",
    data: { name },
  });
}

test("query.sql: flattened views, read-only, tenant isolation", async () => {
  const a = await owner("QA");
  const b = await owner("QB");
  await seed(a, "Alice");
  await seed(b, "Bob");

  const flat = await queryService.sql(a, "select name from contacts;");
  assert.deepEqual(flat.rows, [{ name: "Alice" }]);
  const all = await queryService.sql(a, "select object from records");
  assert.deepEqual(all.rows, [{ object: "contacts" }]);

  // Write: refused.
  await assert.rejects(queryService.sql(a, "delete from public.records"));
  await assert.rejects(
    queryService.sql(
      a,
      "with d as (delete from public.records returning id) select * from d",
    ),
  );
  await assert.rejects(queryService.sql(a, "select * from public.records"));
  assert.equal((await queryService.sql(a, "select 1 as x")).rows.length, 1); // views replayable

  // Cross-tenant: nothing, even when changing app.org_id.
  await assert.rejects(
    queryService.sql(
      a,
      `select r.* from records r, (select set_config('app.org_id', '${b.organizationId}', true)) s
       where r.data->>'name' = 'Bob'`,
    ),
  );
  const [bob] =
    await sql`select count(*)::int as n from records where data->>'name' = 'Bob' and organization_id = ${b.organizationId}`;
  assert.equal(bob!.n, 1);

  // Row limit.
  const many = await queryService.sql(
    a,
    "select generate_series(1, 5000) as n",
  );
  assert.equal(many.rows.length, 1000);
  assert.equal(many.truncated, true);
});

test("query.sql: external_id field without collision with the system column", async () => {
  const ctx = await owner("QExt");
  const obj = await objectsService.create(ctx, {
    slug: "accounts",
    name: "Accounts",
    fields: [{ key: "external_id", label: "Id externe", type: "text" }],
  });
  await recordsService.upsert(ctx, {
    objectId: obj.id,
    externalId: "sys-1",
    data: { external_id: "crm-42" },
  });
  const r = await queryService.sql(
    ctx,
    "select external_id, data_external_id from accounts",
  );
  assert.deepEqual(r.rows, [
    { external_id: "sys-1", data_external_id: "crm-42" },
  ]);
});

test("query.sql: adversarial tests, no escape from the workspace", async () => {
  const a = await owner("QAdvA");
  const b = await owner("QAdvB");
  await seed(a, "Alice");
  await seed(b, "Bob");
  const run = (q: string) => queryService.sql(a, q);

  // Reproduction of the flaw: session_user is no longer the owner.
  const repro = await run(
    "select session_user::text as u, set_config('role', session_user, true) s",
  ).catch((e: Error) => e);
  assert.ok(repro instanceof Error, "set_config must be refused");
  assert.match(repro.message, /permission denied/);
  const who = await run(
    "select session_user::text as u, current_user::text as c",
  );
  assert.deepEqual(who.rows, [{ u: "runbase_query", c: "runbase_query" }]);
  await assert.rejects(
    run(
      "select set_config('role', session_user, true) s, query_to_xml('select count(*) from public.records', false, false, '') x",
    ),
    /permission denied/,
  );
  await assert.rejects(
    run(
      "select query_to_xml('select count(*) from public.records', false, false, '') x",
    ),
    /permission denied/,
  );
  await assert.rejects(
    run(`select set_config('app.org_id', '${b.organizationId}', true) s`),
    /permission denied/,
  );
  // Commands: outside a subquery (refused by the syntax), and a single
  // statement (extended protocol).
  for (const q of [
    "set role runbase",
    "reset role",
    "set session authorization runbase",
    "copy (select 1) to program 'id'",
    "select 1) q; set role runbase; select * from (select 1",
    "select 1) q; commit; create temp view records as select 1 as x; select * from (select 1",
  ])
    await assert.rejects(run(q));
  // Write through a function: large objects, server functions, table.
  await assert.rejects(run("select lo_create(0) as o"), /permission denied/);
  await assert.rejects(
    run("select pg_read_file('/etc/passwd') as f"),
    /permission denied/,
  );
  await assert.rejects(
    run("select * from public.records"),
    /permission denied/,
  );
  await assert.rejects(
    run("select * from public.query_sessions"),
    /permission denied/,
  );
  await assert.rejects(
    run("with d as (delete from query.records returning id) select * from d"),
  );
  // Only the caller's workspace is visible, even through the query schema.
  const all = await run("select data->>'name' as name from query.records");
  assert.deepEqual(all.rows, [{ name: "Alice" }]);
  const after = await run("select count(*)::int as n from records");
  assert.deepEqual(after.rows, [{ n: 1 }]);
  const [left] = await sql`select count(*)::int as n from query_sessions`;
  assert.equal(left!.n, 0);
});

test("query.sql: workflow metrics", async () => {
  const a = await owner("QM");
  const [wf] =
    await sql`insert into workflows (organization_id, workspace_id, name)
      values (${a.organizationId}, ${a.workspaceId}, 'Qualif') returning id`;
  const run = async (
    status: string,
    branch: string,
    cost: number,
    at: string,
  ) => {
    const [r] =
      await sql`insert into workflow_runs (organization_id, workspace_id, workflow_id, version, actor, input, status, created_at)
        values (${a.organizationId}, ${a.workspaceId}, ${wf!.id}, 1, '{}', '{}', ${status}, ${at}) returning id`;
    await sql`insert into run_steps (organization_id, run_id, seq, step_id, branch, cost, created_at)
      values (${a.organizationId}, ${r!.id}, 0, 'qualify', ${branch}, ${cost}, ${at})`;
  };
  await run("succeeded", "hot", 0.5, "2026-10-03");
  await run("succeeded", "cold", 0.25, "2026-10-03");
  await run("failed", "hot", 1, "2026-11-05");
  await run("succeeded", "hot", 0.5, "2026-11-06");

  const cost = await queryService.sql(
    a,
    "select workflow, month, cost_usd from workflow_cost_monthly order by month",
  );
  assert.deepEqual(cost.rows, [
    { workflow: "Qualif", month: "2026-10", cost_usd: 0.75 },
    { workflow: "Qualif", month: "2026-11", cost_usd: 1.5 },
  ]);
  const days = await queryService.sql(
    a,
    "select day::text, runs from workflow_runs_per_day order by day",
  );
  assert.deepEqual(days.rows, [
    { day: "2026-10-03", runs: 2 },
    { day: "2026-11-05", runs: 1 },
    { day: "2026-11-06", runs: 1 },
  ]);
  const err = await queryService.sql(
    a,
    "select runs, failed, error_rate from workflow_error_rate",
  );
  assert.deepEqual(err.rows, [{ runs: 4, failed: 1, error_rate: 0.25 }]);
  const br = await queryService.sql(
    a,
    "select branch, n, rate from workflow_branch_rate order by branch",
  );
  assert.deepEqual(br.rows, [
    { branch: "cold", n: 1, rate: 0.25 },
    { branch: "hot", n: 3, rate: 0.75 },
  ]);
});

test("saved query: signup > trial > paid funnel", async () => {
  const ctx = await owner("QFunnel");
  const obj = await objectsService.create(ctx, {
    slug: "accounts",
    name: "Comptes",
    fields: [
      { key: "signup_at", label: "Inscription", type: "text" },
      { key: "trial_at", label: "Trial", type: "text" },
      { key: "paid_at", label: "Paid", type: "text" },
    ],
  });
  const accounts = [
    { signup_at: "2026-01-01" },
    { signup_at: "2026-01-02", trial_at: "2026-01-03" },
    { signup_at: "2026-01-02", trial_at: "2026-01-03" },
    { signup_at: "2026-01-04", trial_at: "2026-01-05", paid_at: "2026-02-01" },
  ];
  for (const [i, data] of accounts.entries())
    await recordsService.upsert(ctx, {
      objectId: obj.id,
      externalId: String(i),
      data,
    });
  const funnel = `select count(signup_at)::int as signup,
    count(trial_at)::int as trial, count(paid_at)::int as paid from accounts`;
  await queryService.save(ctx, "Funnel", "select 1");
  await queryService.save(ctx, "Funnel", funnel);
  const saved = await queryService.saved(ctx);
  assert.deepEqual(saved, [{ name: "Funnel", sql: funnel }]);
  const res = await queryService.sql(ctx, saved[0]!.sql);
  assert.deepEqual(res.rows, [{ signup: 4, trial: 3, paid: 1 }]);
  await queryService.remove(ctx, "Funnel");
  assert.deepEqual(await queryService.saved(ctx), []);
});

test("query.sql: workspace events view", async () => {
  const { eventsService } = await import("../events");
  const a = await owner("QEa");
  const b = await owner("QEb");
  await eventsService.insert(a, { type: "paid", payload: { amount: 3 } });
  await eventsService.insert(b, { type: "paid", payload: { amount: 9 } });
  const r = await queryService.sql(
    a,
    "select type, (payload->>'amount')::int as amount from events",
  );
  assert.deepEqual(r.rows, [{ type: "paid", amount: 3 }]);
});

test("query.sql: other connections' activity, records object, restricted key", async () => {
  const a = await owner("QHard");
  await seed(a, "Alice");
  const run = (q: string) => queryService.sql(a, q);
  // Query texts of other connections (same role): unreadable.
  await assert.rejects(
    run("select query from pg_catalog.pg_stat_activity"),
    /permission denied/,
  );
  await assert.rejects(
    run("select * from pg_stat_get_activity(null)"),
    /permission denied/,
  );
  // Object named like the system view: query.records stays readable.
  const rec = await objectsService.create(a, {
    slug: "records",
    name: "Records",
    fields: [{ key: "t", label: "T", type: "text" }],
  });
  await recordsService.upsert(a, { objectId: rec.id, data: { t: "x" } });
  const all = await run("select object from records order by object");
  assert.deepEqual(all.rows, [{ object: "contacts" }, { object: "records" }]);
  const own = await run("select t from pg_temp.records");
  assert.deepEqual(own.rows, [{ t: "x" }]);
  // Key limited to some objects: query.sql refused.
  const [k] =
    await sql`insert into api_keys (organization_id, name, workspace_ids, scopes, key_hash, objects)
      values (${a.organizationId}, 'k', ${[a.workspaceId]}, '{read}', ${crypto.randomUUID()}, '{contacts}') returning id`;
  await assert.rejects(
    queryService.sql(
      { ...a, actor: { apiKeyId: k!.id, scopes: ["read"] } },
      "select 1 as x",
    ),
    /limited to some objects/,
  );
});

test("query.sql: duplicate result column names are refused", async () => {
  const a = await owner("QD");
  await assert.rejects(
    queryService.sql(a, "select 1 as n, 2 as n"),
    (e: Error & { code?: string }) =>
      e.code === "query.duplicateColumns" && /unique alias/.test(e.message),
  );
  assert.deepEqual((await queryService.sql(a, "select 1 as n, 2 as m")).rows, [
    { n: 1, m: 2 },
  ]);
});
