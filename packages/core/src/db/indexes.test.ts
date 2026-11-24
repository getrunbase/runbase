// Integration test: requires DATABASE_URL. Run lists
// (by status, by workflow) and event lists use an index, not a seq scan.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => sql.end());

let ws = "";
let wf = "";

before(async () => {
  const [org] =
    await sql`insert into organizations (name) values ('Idx') returning id`;
  const wss = await sql`insert into workspaces (organization_id, name)
    select ${org!.id}, 'W' || g from generate_series(1, 20) g returning id`;
  ws = wss[0]!.id;
  const wfs =
    await sql`insert into workflows (organization_id, workspace_id, name)
    select ${org!.id}, w.id, 'F' || g from unnest(${wss.map((w) => w.id)}::uuid[]) w(id),
      generate_series(1, 5) g returning id`;
  wf = wfs[0]!.id;
  // 20,000 runs spread over 100 workflows / 20 workspaces, various statuses.
  await sql`insert into workflow_runs (organization_id, workspace_id, workflow_id,
      version, actor, input, status, finished_at, created_at)
    select ${org!.id}, f.workspace_id, f.id, 1, '{}', '{}',
      (array['succeeded','failed','canceled'])[1 + g % 3]::run_status, now(),
      now() - g * interval '1 minute'
    from workflows f, generate_series(1, 200) g
    where f.organization_id = ${org!.id}`;
  await sql`insert into events (organization_id, workspace_id, type, occurred_at)
    select ${org!.id}, w.id, 't' || (g % 7), now() - g * interval '1 minute'
    from workspaces w, generate_series(1, 1000) g
    where w.organization_id = ${org!.id}`;
  await sql`analyze workflow_runs`;
  await sql`analyze events`;
});

async function plan(query: string, params: string[]) {
  const rows = await sql.unsafe(`explain ${query}`, params);
  return rows.map((r) => r["QUERY PLAN"] as string).join("\n");
}

test("runs by status: index scan", async () => {
  const p = await plan(
    `select * from workflow_runs where workspace_id = $1 and status = 'failed'
     order by created_at desc limit 50`,
    [ws],
  );
  assert.match(p, /Index Scan.*workflow_runs_workspace_status_created_idx/);
  assert.doesNotMatch(p, /Seq Scan|Sort/);
});

test("runs by workflow: index scan", async () => {
  const p = await plan(
    `select * from workflow_runs where workflow_id = $1
     order by created_at desc limit 50`,
    [wf],
  );
  assert.match(p, /Index Scan.*workflow_runs_workflow_created_idx/);
  assert.doesNotMatch(p, /Seq Scan|Sort/);
});

test("workspace events: index scan", async () => {
  const p = await plan(
    `select * from events where workspace_id = $1
     order by occurred_at desc, id desc limit 51`,
    [ws],
  );
  assert.match(p, /Index Scan.*events_workspace_occurred_idx/);
  assert.doesNotMatch(p, /Seq Scan|Sort/);
});
