// Acceptance test: an agent writes a function, tests it, then
// uses it as a fn.<name> block in a workflow, entirely through MCP.
// Requires DATABASE_URL, QUERY_DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { TenantContext } from "@getrunbase/core/tenant";
import { client, owner, raw, sql } from "./test-client";

after(() => setImmediate(() => process.exit(0)));

test("function written, tested then used in a workflow through MCP", async () => {
  const call = client(await owner());

  await call("functions.create", {
    name: "score",
    code: `export default (i) => ({ branch: i.score >= 50 ? "hot" : "cold", score: i.score })`,
    outputSchema: {
      type: "object",
      properties: { branch: { enum: ["hot", "cold"] } },
    },
  });
  const t = await call("functions.test", {
    name: "score",
    input: { score: 80 },
  });
  assert.equal(t.output.branch, "hot");

  const blocks = await call("blocks.list");
  const fn = blocks.find((b: { type: string }) => b.type === "fn.score");
  assert.deepEqual(fn.branches, ["hot", "cold"]);

  await call("objects.create", {
    slug: "lead",
    name: "Lead",
    fields: [
      { key: "score", label: "Score", type: "number" },
      { key: "stage", label: "Stage", type: "text" },
    ],
  });
  const [lead] = await call("records.upsert_batch", {
    object: "lead",
    items: [{ data: { score: 90 } }],
  });
  const update = (stage: string) => ({
    type: "record.update",
    input: { recordId: "{{record.id}}", data: { stage } },
  });
  const definition = {
    trigger: { type: "trigger.manual" },
    steps: [
      { id: "s", type: "fn.score", input: { score: "{{record.data.score}}" } },
      { id: "hot", ...update("sales") },
      { id: "cold", ...update("nurture") },
    ],
    next: { s: { hot: ["hot"], cold: ["cold"] } },
  };
  const wf = await call("workflows.create", { name: "Score", definition });
  const {
    results: [dry],
  } = await call("workflows.dry_run", {
    workflow: wf.id,
    records: [lead.record.id],
  });
  assert.deepEqual(
    dry.path.map((p: { stepId: string }) => p.stepId),
    ["s", "hot"],
  );
  await call("workflows.activate", { id: wf.id });

  // New version, then deletion.
  await assert.rejects(
    call("functions.create", { name: "score", code: "x" }),
    /already exists/,
  );
  assert.equal(
    (
      await call("functions.update", {
        name: "score",
        code: "export default () => ({})",
      })
    ).version,
    2,
  );
  assert.equal(
    await call("functions.delete", { name: "score", confirm: true }),
    true,
  );
  assert.equal((await call("functions.list")).length, 0);
});

test("secrets, queries and admin scope through MCP", async () => {
  const ctx = await owner();
  const call = client(ctx);

  await call("secrets.set", { name: "API_KEY", value: "s3cr3t" });
  const secrets = await call("secrets.list");
  assert.deepEqual(
    secrets.map((s: { name: string }) => s.name),
    ["API_KEY"],
  );
  assert.ok(!JSON.stringify(secrets).includes("s3cr3t"));

  await call("objects.create", {
    slug: "contact",
    name: "Contacts",
    fields: [{ key: "name", label: "Nom", type: "text" }],
  });
  await call("records.upsert", { object: "contact", data: { name: "Ada" } });
  const res = await call("query.sql", { sql: "select name from contact" });
  assert.deepEqual(res.rows, [{ name: "Ada" }]);
  await call("query.save", { name: "Noms", sql: "select name from contact" });
  assert.equal((await call("query.saved")).length, 1);
  await call("query.delete", { name: "Noms" });
  assert.equal((await call("query.saved")).length, 0);

  // A member (write scope): refused by the services, not by the MCP.
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'M', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${ctx.organizationId}, 'member')`;
  const member = raw({ ...ctx, actor: { userId: uid } } as TenantContext);
  for (const [name, args] of [
    ["secrets.set", { name: "X", value: "y" }],
    ["secrets.delete", { name: "API_KEY" }],
    ["functions.create", { name: "f", code: "x" }],
  ] as const) {
    const r = await member(name, args);
    assert.ok(r.isError && /admin/.test(r.content[0]!.text), name);
  }
  await call("secrets.delete", { name: "API_KEY" });
  assert.equal((await call("secrets.list")).length, 0);
});
