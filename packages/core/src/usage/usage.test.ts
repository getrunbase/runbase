// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { registerExtensions, resetExtensions } from "../extensions";
import { collectUsage, reportUsage } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));
after(() => resetExtensions());

async function workspace() {
  const [o] = await sql`insert into organizations (name) values ('U') returning id`;
  const [w] =
    await sql`insert into workspaces (organization_id, name) values (${o!.id}, 'W') returning id`;
  const [d] = await sql`insert into databases (organization_id, workspace_id, name, slug)
    values (${o!.id}, ${w!.id}, 'D', 'd') returning id`;
  const [ob] = await sql`insert into objects (organization_id, workspace_id, database_id, name, slug)
    values (${o!.id}, ${w!.id}, ${d!.id}, 'O', 'o') returning id`;
  const [f] = await sql`insert into workflows (organization_id, workspace_id, name)
    values (${o!.id}, ${w!.id}, 'F') returning id`;
  return { org: o!.id as string, ws: w!.id as string, obj: ob!.id as string, wf: f!.id as string };
}

const file = (ws: string, size: number) => ({
  key: `${ws}/${crypto.randomUUID()}/a.png`,
  name: "a.png",
  size,
  type: "image/png",
});

test("collectUsage: records, runs of the month, attached file bytes", async () => {
  const a = await workspace();
  const b = await workspace();
  const rec = (data: unknown) => sql`insert into records (organization_id, workspace_id, object_id, data)
    values (${a.org}, ${a.ws}, ${a.obj}, ${sql.json(data as never)})`;
  await rec({ doc: file(a.ws, 100), gallery: [file(a.ws, 20), file(a.ws, 3)] });
  await rec({ title: "no file", size: 999 });
  // A key from another workspace is not counted.
  await rec({ doc: file(b.ws, 5000) });
  const run = (at: string) => sql`insert into workflow_runs (organization_id, workspace_id, workflow_id,
    version, actor, input, status, created_at)
    values (${a.org}, ${a.ws}, ${a.wf}, 1, '{}', '{}', 'succeeded', ${at})`;
  await run("2026-03-02T00:00:00Z");
  await run("2026-03-31T23:00:00Z");
  await run("2026-02-28T23:00:00Z");

  const now = new Date("2026-03-31T23:30:00Z");
  const [ua, ub] = await collectUsage({ now, workspaceIds: [a.ws, b.ws].sort() }).then((r) =>
    [a.ws, b.ws].map((id) => r.find((u) => u.workspaceId === id)!),
  );
  assert.deepEqual(ua, { workspaceId: a.ws, records: 3, runs: 2, storageBytes: 123 });
  assert.deepEqual(ub, { workspaceId: b.ws, records: 0, runs: 0, storageBytes: 0 });
  assert.deepEqual(await collectUsage({ workspaceIds: [] }), []);
});

test("reportUsage: one call per metric, a failure does not stop the others", async () => {
  const a = await workspace();
  const calls: [string, string, number][] = [];
  registerExtensions({
    billing: {
      entitlements: async () => null,
      reportUsage: async (ws, metric, n) => {
        if (metric === "runs") throw new Error("down");
        calls.push([ws, metric, n]);
      },
    },
  });
  const r = await reportUsage({ workspaceIds: [a.ws] });
  assert.deepEqual(r, { workspaces: 1, reported: 2, failed: 1 });
  assert.deepEqual(calls, [
    [a.ws, "records", 0],
    [a.ws, "storageBytes", 0],
  ]);
});
