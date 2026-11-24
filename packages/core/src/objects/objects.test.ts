// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { type TenantContext } from "../tenant";
import { objectsService, recordValidator } from "./index";

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

test("dynamic validator: each field type", () => {
  const v = recordValidator([
    { key: "name", label: "Name", type: "text", required: true },
    { key: "n", label: "N", type: "number" },
    { key: "b", label: "B", type: "bool" },
    { key: "d", label: "D", type: "date" },
    { key: "s", label: "S", type: "select", options: ["a", "b"] },
    { key: "m", label: "M", type: "multi_select", options: ["a", "b"] },
    { key: "e", label: "E", type: "email" },
    { key: "u", label: "U", type: "url" },
    { key: "j", label: "J", type: "json" },
    { key: "r", label: "R", type: "ref", object: "company" },
  ]);
  const ok = {
    name: "x",
    n: 1,
    b: true,
    d: "2026-01-02",
    s: "a",
    m: ["a", "b"],
    e: "a@b.io",
    u: "https://x.io",
    j: { k: [1] },
    r: crypto.randomUUID(),
  };
  assert.deepEqual(v.parse(ok), ok);
  assert.equal(v.safeParse({}).success, false); // name required
  for (const bad of [
    { n: "1" },
    { b: 1 },
    { d: "yesterday" },
    { s: "z" },
    { m: ["z"] },
    { e: "x" },
    { u: "x" },
    { r: "x" },
  ])
    assert.equal(
      v.safeParse({ name: "x", ...bad }).success,
      false,
      JSON.stringify(bad),
    );
});

test("object CRUD without migration, unknown fields kept", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("A");
  const b = await owner("B");

  const obj = await objectsService.create(a, {
    slug: "contact",
    name: "Contact",
    icon: "user",
    fields: [
      { key: "email", label: "Email", type: "email", required: true },
      { key: "age", label: "Age", type: "number" },
    ],
  });
  const record = { email: "a@b.io", age: 30 };
  assert.ok(objectsService.validator(obj).safeParse(record).success);

  // Schema modified: `age` removed, `stage` added.
  const upd = await objectsService.update(a, obj.id, {
    name: "Person",
    fields: [
      { key: "email", label: "Email", type: "email", required: true },
      {
        key: "stage",
        label: "Stage",
        type: "select",
        options: ["lead", "client"],
      },
    ],
  });
  assert.equal(upd!.name, "Person");
  const parsed = objectsService.validator(upd!).parse(record);
  assert.deepEqual(parsed, { email: "a@b.io", age: 30 }); // `age` kept

  await assert.rejects(
    objectsService.create(a, {
      slug: "x",
      name: "X",
      fields: [{ key: "k", label: "K", type: "select", options: [] }],
    } as never),
  );

  // Relation target: uuid normalized to slug, unknown target refused.
  const lien = await objectsService.create(a, {
    slug: "lien",
    name: "Lien",
    fields: [
      { key: "c", label: "C", type: "ref", object: obj.id },
      { key: "moi", label: "Moi", type: "refs", object: "lien" },
    ],
  });
  assert.deepEqual(
    (lien.fields as { object: string }[]).map((f) => f.object),
    ["contact", "lien"],
  );
  await assert.rejects(
    objectsService.update(a, lien.id, {
      fields: [{ key: "c", label: "C", type: "ref", object: "inconnu" }],
    }),
    /not found/,
  );
  await objectsService.remove(a, lien.id, { confirm: true });

  assert.equal((await objectsService.list(b)).length, 0); // isolation
  assert.equal(await objectsService.remove(b, obj.id, { confirm: true }), null);
  assert.equal(
    (await objectsService.remove(a, obj.id, { confirm: true }))!.id,
    obj.id,
  );
  assert.equal(await objectsService.get(a, "contact"), null);
});
