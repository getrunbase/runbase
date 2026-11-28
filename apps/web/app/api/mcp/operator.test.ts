// Super operator agent through MCP: machine-coded errors, confirm guards,
// test data and purge, overview, workspace audit, dry run and
// function logs. Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { client, owner, raw } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

test("missing target: isError, not_found code and actionable message", async () => {
  const ctx = await owner();
  const r = raw(ctx);
  const call = client(ctx);
  const expectCode = async (
    name: string,
    args: Record<string, unknown>,
    code: string,
    hint?: RegExp,
  ) => {
    const res = await r(name, args);
    assert.equal(res.isError, true, name);
    assert.match(res.content[0]!.text, new RegExp(`^\\[${code}\\]`), name);
    if (hint) assert.match(res.content[0]!.text, hint, name);
  };
  await expectCode("records.delete", { id: UNKNOWN }, "not_found", /records/);
  await expectCode("webhooks.delete", { id: UNKNOWN }, "not_found");
  await expectCode("runs.start", { id: UNKNOWN }, "not_found");
  await expectCode("runs.get", { id: UNKNOWN }, "not_found");
  await expectCode("runs.decide", { id: UNKNOWN, approved: true }, "not_found");
  await expectCode(
    "functions.delete",
    { name: "absente", confirm: true },
    "not_found",
  );
  await call("functions.save", { name: "f", code: "export default () => 1" });
  await expectCode(
    "functions.restore",
    { name: "f", version: 9 },
    "not_found",
    /functions\.versions/,
  );
  await expectCode("functions.test", { name: "nope" }, "not_found");
  await expectCode("functions.delete", { name: "f" }, "confirm_required");
  await expectCode(
    "runs.cancel_bulk",
    { status: "running" },
    "confirm_required",
  );
  await expectCode("records.purge", {}, "confirm_required");
  await expectCode("workspace.purge_test", {}, "confirm_required");

  // Active run (no worker): decision refused with the reason.
  const wf = await call("workflows.create", {
    name: "W",
    definition: {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "a",
          type: "record.update",
          input: { recordId: "{{record.id}}", data: {} },
        },
      ],
      next: {},
    },
  });
  const run = await call("runs.start", { id: wf.id });
  await expectCode(
    "runs.decide",
    { id: run.id, approved: true },
    "not_waiting",
    /not waiting/,
  );

  // Unexpected failure logged (mcp source), invalid input not.
  await r("query.sql", { sql: "select * from nope" });
  await r("records.search", {});
  const errs = await call("errors.list", { source: "mcp" });
  assert.equal(errs.items.length, 1);
  assert.equal(errs.items[0].request, "query.sql");
  assert.equal(errs.hasMore, false);
});

test("test data: label, purge_test and describe", async () => {
  const ctx = await owner();
  const call = client(ctx);
  await call("databases.create", { slug: "crm", name: "CRM" });
  await call("objects.create", {
    slug: "lead",
    name: "Lead",
    database: "crm",
    fields: [{ key: "name", label: "Nom", type: "text" }],
  });
  await call("records.upsert", { object: "lead", data: { name: "réel" } });
  await call("records.upsert_batch", {
    object: "lead",
    items: [
      { data: { name: "t1" }, test: true },
      { data: { name: "t2" }, test: true },
    ],
  });
  await call("events.push", { type: "essai", test: true });
  await call("secrets.set", { name: "K", value: "v" });

  const d = await call("workspace.describe");
  const crm = d.databases.find((x: { slug: string }) => x.slug === "crm");
  assert.equal(crm.objects[0].slug, "lead");
  assert.equal(crm.objects[0].records, 3);
  assert.deepEqual(d.secrets, ["K"]);
  assert.equal(d.counts.records, 3);
  assert.ok(!JSON.stringify(d).includes('"v"'));
  assert.deepEqual(d.dependencies, {});
  const deps = await call("workspace.dependencies");
  assert.deepEqual(Object.keys(deps).sort(), [
    "fields",
    "functions",
    "pages",
    "workflows",
  ]);
  assert.deepEqual(
    (await call("workspace.dependencies", { entity: "lead" })).fields,
    {},
  );

  assert.deepEqual(await call("workspace.purge_test", { dryRun: true }), {
    dryRun: true,
    records: 2,
    events: 1,
    runs: 0,
  });
  const out = await call("workspace.purge_test", { confirm: true });
  assert.deepEqual(out, { records: 2, events: 1, runs: 0, hasMore: false });
  const left = await call("records.search", { object: "lead" });
  assert.deepEqual(
    left.records.map((r: { data: { name: string } }) => r.data.name),
    ["réel"],
  );
  assert.equal((await call("records.trash", { object: "lead" })).length, 0);
});

test("audit.list: workspace feed filtered and paginated", async () => {
  const call = client(await owner());
  await call("objects.create", {
    slug: "c",
    name: "C",
    fields: [{ key: "n", label: "N", type: "text" }],
  });
  for (const n of ["a", "b", "c"])
    await call("records.upsert", { object: "c", data: { n } });
  const all = await call("audit.list", {});
  assert.ok(all.items.length >= 4);
  const p1 = await call("audit.list", { action: "record.", limit: 2 });
  assert.equal(p1.items.length, 2);
  assert.equal(p1.hasMore, true);
  const p2 = await call("audit.list", {
    action: "record.",
    limit: 2,
    cursor: p1.nextCursor,
  });
  assert.equal(p2.items.length, 1);
  assert.equal(p2.hasMore, false);
  assert.ok(
    p2.items.every((i: { action: string }) => i.action.startsWith("record.")),
  );
});

test("functions.test dryRun: simulated writes; logs available", async () => {
  const call = client(await owner());
  await call("objects.create", {
    slug: "lead",
    name: "Lead",
    fields: [{ key: "name", label: "Nom", type: "text" }],
  });
  await call("functions.save", {
    name: "add",
    code: `export default async (i, { records }) => {
      console.log("ajout", i.name);
      const { record } = await records.upsert({ objectId: "lead", data: { name: i.name } });
      const found = await records.search("lead", {});
      return { id: record.id, seen: found.length };
    }`,
    permissions: { domains: [], secrets: [], records: "write" },
  });
  const dry = await call("functions.test", {
    name: "add",
    input: { name: "Ada" },
    dryRun: true,
  });
  assert.equal(dry.writes.length, 1);
  assert.equal(dry.writes[0].method, "upsert");
  assert.equal(dry.output.seen, 0);
  assert.match(dry.logs, /ajout Ada/);

  const real = await call("functions.test", {
    name: "add",
    input: { name: "Bo" },
  });
  assert.equal(real.output.seen, 1);
  assert.equal(real.writes, undefined);

  const logs = await call("functions.logs", { name: "add" });
  assert.equal(logs.items.length, 2);
  assert.equal(logs.items[0].source, "test");
  assert.match(logs.items[0].logs, /ajout Bo/);
});

test("feedback.send: the agent reports a bug, stored for the admin", async () => {
  const call = client(await owner());
  const out = await call("feedback.send", {
    kind: "bug",
    title: "records.search ignore le filtre",
    details: "Filtre status=won renvoie aussi les lost.",
    tool: "records.search",
    context: { filter: { status: "won" } },
  });
  assert.equal(out.received, true);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const [row] = await sql`select kind, tool from feedback where id = ${out.id}`;
  await sql.end();
  assert.deepEqual({ ...row }, { kind: "bug", tool: "records.search" });
});
