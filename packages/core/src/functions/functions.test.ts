// Integration test: requires DATABASE_URL.
import { blockEngine } from "../blocks/engine";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { withTenant, type TenantContext } from "../tenant";
import { functions } from "../db/schema";
import { functionsService as fn } from "./index";

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

test("create, edit, restore a function; reference by name or version", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("FA");
  const b = await owner("FB");

  const v1 = await fn.save(a, {
    name: "enrich",
    code: "export default () => 1",
    permissions: { domains: ["api.x.io"], secrets: ["X_KEY"] },
  });
  assert.equal(v1.version, 1);
  const v2 = await fn.save(a, {
    name: "enrich",
    code: "export default () => 2",
  });
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.permissions, { domains: [], secrets: [] });

  assert.equal((await fn.get(a, "enrich"))!.code, "export default () => 2");
  assert.equal((await fn.get(a, "enrich", 1))!.code, "export default () => 1");

  const r = await fn.restore(a, "enrich", 1);
  assert.equal(r!.version, 3);
  assert.equal(r!.code, "export default () => 1");
  assert.deepEqual(r!.permissions, {
    domains: ["api.x.io"],
    secrets: ["X_KEY"],
  });
  assert.deepEqual(
    (await fn.versions(a, "enrich")).map((v) => v.version),
    [1, 2, 3],
  );
  assert.deepEqual(
    (await fn.list(a)).map((f) => [f.name, f.version]),
    [["enrich", 3]],
  );

  // Versions immuables.
  await assert.rejects(
    withTenant(a, (tx) => tx.update(functions).set({ code: "x" })),
  );
  await assert.rejects(fn.save(a, { name: "Bad Name", code: "x" }));

  // Isolation.
  assert.equal((await fn.list(b)).length, 0);
  assert.equal(await fn.get(b, "enrich"), null);
  assert.equal(await fn.restore(b, "enrich", 1), null);
  assert.equal(await fn.restore(a, "enrich", 99), null);
});

test("function usable as fn.<name> block as soon as saved; functions.test with logs", async () => {
  const { blockContext, blocksService, getBlock } = await import("../blocks");
  const { validateDefinition } = await import("../workflows/validate");
  const a = await owner("FC");
  await fn.save(a, {
    name: "score",
    code: `export default (i) => { console.log("calc", i.n); return { branch: i.n > 10 ? "hot" : "cold", n: i.n }; }`,
    inputSchema: {
      type: "object",
      properties: { n: { type: "number" } },
      required: ["n"],
    },
    outputSchema: {
      type: "object",
      properties: { branch: { type: "string", enum: ["hot", "cold"] } },
    },
  });

  const listed = (await blocksService.list(a)).find(
    (b) => b.type === "fn.score",
  );
  assert.deepEqual(listed?.branches, ["hot", "cold"]);

  // Custom condition in a workflow.
  const def = {
    steps: [
      { id: "s", type: "fn.score", input: { n: "{{record.data.n}}" } },
      { id: "h", type: "wait", input: { duration: "1s" } },
      { id: "c", type: "wait", input: { duration: "1s" } },
    ],
    next: { s: { hot: ["h"], cold: ["c"] } },
  };
  assert.deepEqual(await validateDefinition(a, def as never), []);
  const block = (await getBlock(a, "fn.score"))!;
  const res = await block.run({ n: 42 }, blockContext(a));
  assert.equal(res.branch, "hot");
  assert.equal(await getBlock(a, "fn.absent"), undefined);

  // Pinned version: fn.<name>@<version>.
  await fn.save(a, { name: "score", code: `export default () => ({ v: 2 })` });
  assert.equal((await getBlock(a, "fn.score@1"))!.branches[0], "hot");
  assert.deepEqual(
    (await (await getBlock(a, "fn.score"))!.run({}, blockContext(a))).output,
    { v: 2 },
  );
  assert.equal(await getBlock(a, "fn.score@9"), undefined);
  assert.equal(await getBlock(a, "fn.score@x"), undefined);

  // In a loop: fn.* resolved with the run tenant.
  const { blocks } = await import("../blocks");
  const loop = await blocks.loop!.run(
    blocks.loop!.inputSchema.parse({
      items: [1],
      do: [{ id: "f", type: "fn.score@1", input: { n: "{{item}}" } }],
    }),
    blockContext(a, 0, { engine: blockEngine(a) }),
  );
  assert.deepEqual((loop.output as { results: unknown[] }).results, [
    { f: { branch: "cold", n: 1 } },
  ]);

  const t = await fn.test(a, "score", { n: 3 }, 1);
  assert.deepEqual(t.output, { branch: "cold", n: 3 });
  assert.match(t.logs, /calc 3/);
});

test("functions.test: secrets masked in logs and output", async () => {
  const { secretsService } = await import("../secrets");
  const a = await owner("FS");
  await secretsService.set(a, "TOK", "valeur-tres-secrete");
  await fn.save(a, {
    name: "leak",
    code: `export default (i) => { console.log(i.secrets.TOK); return { t: i.secrets.TOK }; }`,
    permissions: { domains: [], secrets: ["TOK"] },
  });
  const t = await fn.test(a, "leak", {});
  assert.deepEqual(t.output, { t: "***" });
  assert.doesNotMatch(t.logs, /valeur-tres-secrete/);
});

test("records SDK in the sandbox: read/write gated by permissions.records", async () => {
  const { objectsService } = await import("../objects");
  const { recordsService } = await import("../records");
  const a = await owner("FR");
  const o = await objectsService.create(a, {
    slug: "company",
    name: "Company",
    fields: [{ key: "name", label: "Nom", type: "text" }],
  });
  const code = `export default async (i) => {
    const { record: r } = await records.upsert({ objectId: i.o, externalId: "x1", data: { name: "Acme" } });
    const found = await records.search(i.o, {});
    return { id: r.id, n: found.length, name: (await records.get(r.id)).data.name };
  }`;
  await fn.save(a, {
    name: "rw",
    code,
    permissions: { domains: [], secrets: [], records: "write" },
  });
  const t = await fn.test(a, "rw", { o: o.id });
  const out = t.output as { id: string; n: number; name: string };
  assert.equal(out.n, 1);
  assert.equal(out.name, "Acme");
  assert.equal((await recordsService.get(a, out.id)).data.name, "Acme");

  await fn.save(a, {
    name: "ro",
    code,
    permissions: { domains: [], secrets: [], records: "read" },
  });
  await assert.rejects(fn.test(a, "ro", { o: o.id }), /write/);
  await fn.save(a, { name: "none", code });
  await assert.rejects(fn.test(a, "none", { o: o.id }), /permissions\.records/);
});

test("events SDK in the sandbox: push and list gated by permissions.events", async () => {
  const a = await owner("FE");
  const code = `export default async () => {
    await events.push({ type: "fn.ping", payload: { n: 1 }, idempotencyKey: "k1" });
    const { items } = await events.list({ type: "fn.ping" });
    return { n: items.length, src: items[0].source };
  }`;
  await fn.save(a, {
    name: "ev",
    code,
    permissions: { domains: [], secrets: [], events: "write" },
  });
  assert.deepEqual((await fn.test(a, "ev", {})).output, {
    n: 1,
    src: "function",
  });
  await fn.save(a, {
    name: "evro",
    code,
    permissions: { domains: [], secrets: [], events: "read" },
  });
  await assert.rejects(fn.test(a, "evro", {}), /permissions\.events "write"/);
});

test("records SDK: delete, merge, object slug; logs and errors of a page call", async () => {
  const { objectsService } = await import("../objects");
  const { recordsService } = await import("../records");
  const { errorsService } = await import("../errors");
  const a = await owner("FM");
  const o = await objectsService.create(a, {
    slug: "contact",
    name: "Contact",
    fields: [{ key: "name", label: "Nom", type: "text" }],
  });
  const ids = [];
  for (const name of ["a", "b", "c"])
    ids.push(
      (await recordsService.upsert(a, { objectId: o.id, data: { name } }))
        .record.id,
    );
  await fn.save(a, {
    name: "clean",
    code: `export default async (i) => {
      await records.delete(i.del);
      await records.merge(i.keep, [i.dup]);
      return { left: (await records.search("contact", {})).length };
    }`,
    permissions: { domains: [], secrets: [], records: "write" },
  });
  const t = await fn.test(a, "clean", {
    del: ids[0],
    keep: ids[1],
    dup: ids[2],
  });
  assert.deepEqual(t.output, { left: 1 });
  await assert.rejects(
    fn.test(a, "clean", { del: ids[0], keep: ids[1], dup: ids[2] }),
    /records\.delete: record not found/,
  );

  await fn.save(a, {
    name: "boom",
    code: `export default () => { console.log("trace"); throw new Error("broken"); }`,
  });
  await assert.rejects(fn.call(a, "boom", {}), /broken/);
  const logs = await fn.logs(a, { name: "boom" });
  assert.equal(logs.items[0]!.source, "page");
  assert.match(logs.items[0]!.logs, /trace/);
  assert.match(logs.items[0]!.error!, /broken/);
  const errs = await errorsService.list(a, { source: "function" });
  assert.equal(errs.items[0]!.request, "boom");
});
