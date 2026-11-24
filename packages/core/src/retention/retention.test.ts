// Integration test: requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Queue } from "bullmq";
import postgres from "postgres";
import { busConnection } from "../bus";
import { registerExtensions, resetExtensions } from "../extensions";
import {
  MAX_BATCH,
  purgeRetention,
  purgeStaleOAuthClients,
  RETENTION_QUEUE,
  retentionDays,
  startRetentionWorker,
} from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

// Retention per organization provided by a test extension.
const days = new Map<string, number>();
registerExtensions({
  billing: {
    entitlements: async (o) =>
      days.has(o)
        ? { features: [], quotas: { "quota:retentionDays": days.get(o)! } }
        : null,
    reportUsage: async () => {},
  },
});
after(() => resetExtensions());

async function org(retention: number) {
  const [o] =
    await sql`insert into organizations (name) values ('R') returning id`;
  days.set(o!.id, retention);
  const [w] =
    await sql`insert into workspaces (organization_id, name) values (${o!.id}, 'W') returning id`;
  const [f] =
    await sql`insert into workflows (organization_id, workspace_id, name)
    values (${o!.id}, ${w!.id}, 'F') returning id`;
  return { org: o!.id as string, ws: w!.id as string, wf: f!.id as string };
}

const count = async (table: string, orgId: string) =>
  (
    await sql.unsafe(
      `select count(*)::int as n from ${table} where organization_id = $1`,
      [orgId],
    )
  )[0]!.n as number;

test("retention: from entitlements, none without extension or env", async () => {
  const a = await org(30);
  const b = await org(90);
  assert.equal(await retentionDays(a.org), 30);
  assert.equal(await retentionDays(b.org), 90);
  assert.equal(await retentionDays(crypto.randomUUID()), null);
});

test("purge: old data in batches ≤ 5k, recent data untouched, idempotent", async () => {
  const short = await org(30);
  const long = await org(90);
  // 12,000 old events (40 d) and 50 recent ones in the short org.
  await sql`insert into events (organization_id, workspace_id, type, occurred_at)
    select ${short.org}, ${short.ws}, 'old', now() - interval '40 days'
    from generate_series(1, 12000)`;
  await sql`insert into events (organization_id, workspace_id, type)
    select ${short.org}, ${short.ws}, 'new' from generate_series(1, 50)`;
  // Long org: 40 d stays under its retention (90 d).
  await sql`insert into events (organization_id, workspace_id, type, occurred_at)
    select ${long.org}, ${long.ws}, 'old', now() - interval '40 days'
    from generate_series(1, 10)`;
  // Runs: 3 old finished ones (with steps), 1 old one still running, 1 recent.
  const runs =
    await sql`insert into workflow_runs (organization_id, workspace_id,
      workflow_id, version, actor, input, status, finished_at, created_at)
    values
      (${short.org}, ${short.ws}, ${short.wf}, 1, '{}', '{}', 'succeeded', now() - interval '39 days', now() - interval '40 days'),
      (${short.org}, ${short.ws}, ${short.wf}, 1, '{}', '{}', 'failed', now() - interval '39 days', now() - interval '40 days'),
      (${short.org}, ${short.ws}, ${short.wf}, 1, '{}', '{}', 'canceled', now() - interval '39 days', now() - interval '40 days'),
      (${short.org}, ${short.ws}, ${short.wf}, 1, '{}', '{}', 'waiting', null, now() - interval '40 days'),
      (${short.org}, ${short.ws}, ${short.wf}, 1, '{}', '{}', 'succeeded', now(), now())
    returning id`;
  await sql`insert into run_steps (organization_id, run_id, seq, step_id, created_at)
    select ${short.org}, r.id, 1, 's', now() - interval '40 days'
    from unnest(${runs.map((r) => r.id)}::uuid[]) r(id)`;
  await sql`insert into audit_log (organization_id, workspace_id, action,
      resource_type, resource_id, created_at)
    values (${short.org}, ${short.ws}, 'x', 'y', 'z', now() - interval '40 days'),
      (${short.org}, ${short.ws}, 'x', 'y', 'z', now())`;
  await sql`insert into function_logs (organization_id, workspace_id,
      function_name, version, source, created_at)
    values (${short.org}, ${short.ws}, 'f', 1, 'test', now() - interval '40 days'),
      (${short.org}, ${short.ws}, 'f', 1, 'test', now())`;

  const scope = [short.org, long.org];
  const r = await purgeRetention({ pauseMs: 1, organizationIds: scope });
  assert.deepEqual(r.deleted, {
    events: 12000,
    workflow_runs: 3,
    audit_log: 1,
    function_logs: 1,
  });
  // events: 5,000 + 5,000 + 2,000; runs, audit, logs: 1 batch each.
  assert.equal(r.batches, 6);
  assert.equal(MAX_BATCH, 5000);

  assert.equal(await count("events", short.org), 50);
  assert.equal(await count("events", long.org), 10);
  assert.equal(await count("workflow_runs", short.org), 2);
  assert.equal(await count("run_steps", short.org), 2);
  assert.equal(await count("audit_log", short.org), 1);
  assert.equal(await count("function_logs", short.org), 1);

  // Rerun: nothing more to delete.
  assert.deepEqual(
    await purgeRetention({ pauseMs: 0, organizationIds: scope }),
    {
      deleted: {},
      batches: 0,
    },
  );
});

test("custom batch size: loops until exhausted", async () => {
  const o = await org(30);
  await sql`insert into function_logs (organization_id, workspace_id,
      function_name, version, source, created_at)
    select ${o.org}, ${o.ws}, 'f', 1, 'test', now() - interval '40 days'
    from generate_series(1, 25)`;
  const r = await purgeRetention({
    batchSize: 10,
    pauseMs: 0,
    organizationIds: [o.org],
  });
  assert.deepEqual(r, { deleted: { function_logs: 25 }, batches: 3 });
});

test("scheduler: a single job scheduler across workers (multi-node)", async () => {
  const workers = [startRetentionWorker(), startRetentionWorker()];
  const queue = new Queue(RETENTION_QUEUE, { connection: busConnection() });
  try {
    let schedulers: unknown[] = [];
    for (let i = 0; i < 50 && schedulers.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      schedulers = await queue.getJobSchedulers();
    }
    assert.equal(schedulers.length, 1);
  } finally {
    await Promise.all(workers.map((w) => w.close()));
    await queue.removeJobScheduler("retention");
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

test("oauth: unconsented dynamic clients purged after 24 h only", async () => {
  const id = () => `t-${crypto.randomUUID()}`;
  const client = async (ageH: number, skipConsent = false) => {
    const c = id();
    await sql`insert into oauth_client (id, client_id, redirect_uris, skip_consent, created_at)
      values (${c}, ${c}, ${["http://localhost/cb"]}, ${skipConsent},
        now() - make_interval(hours => ${ageH}))`;
    return c;
  };
  const stale = await client(25);
  const fresh = await client(1);
  const trusted = await client(25, true);
  const consented = await client(25);
  await sql`insert into oauth_consent (id, client_id, scopes, created_at, updated_at)
    values (${id()}, ${consented}, ${["openid"]}, now(), now())`;
  assert.ok((await purgeStaleOAuthClients()) >= 1);
  const left = (
    await sql`select client_id from oauth_client
      where client_id in ${sql([stale, fresh, trusted, consented])}`
  ).map((r) => r.client_id);
  assert.deepEqual(left.sort(), [fresh, trusted, consented].sort());
});
