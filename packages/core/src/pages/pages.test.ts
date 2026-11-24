// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { AppError } from "../errors/app-error";
import { pagesService as pg } from "./index";

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

const code = (s: string) => `export default () => <p>${s}</p>;`;
const rejectsCode = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);

test("validation: invalid paths and missing entry refused", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("Paths");
  for (const path of [
    "../x.tsx",
    "/abs.tsx",
    "a/../b.tsx",
    "a//b.tsx",
    "./x.tsx",
    "a\\b.tsx",
    "",
  ])
    await rejectsCode(
      pg.create(a, { name: "P", files: { "index.tsx": "", [path]: "" } }),
      "pages.invalidPath",
    );
  await rejectsCode(
    pg.create(a, { name: "P", files: { "app.tsx": code("x") } }),
    "pages.entryMissing",
  );
  await rejectsCode(
    pg.create(a, { name: "P", entry: "main.tsx", files: { "index.tsx": "" } }),
    "pages.entryMissing",
  );
  const p = await pg.create(a, {
    name: "P",
    files: { "index.tsx": code("x") },
  });
  await rejectsCode(
    pg.patchFiles(a, p.id, [{ op: "write", path: "../evil.ts", source: "" }]),
    "pages.invalidPath",
  );
  await rejectsCode(
    pg.patchFiles(a, p.id, [{ op: "delete", path: "index.tsx" }]),
    "pages.entryMissing",
  );
  await rejectsCode(
    pg.patchFiles(a, p.id, [{ op: "delete", path: "nope.ts" }]),
    "pages.fileNotFound",
  );
  await rejectsCode(
    pg.patchFiles(a, p.id, [
      { op: "rename", from: "index.tsx", to: "/root.tsx" },
    ]),
    "pages.invalidPath",
  );
  assert.equal(await pg.list(a).then((l) => l.length), 1);
});

test("CRUD files, draft, publish, restore, isolation", async () => {
  const a = await owner("A");
  const b = await owner("B");
  const p = await pg.create(a, {
    name: "Leads",
    files: { "index.tsx": code("v1"), "components/card.tsx": code("card") },
    permissions: { objects: ["o1"] },
  });
  assert.equal(p.entry, "index.tsx");
  assert.equal(p.currentVersion, null);
  // Never published: nothing for users, the draft is readable.
  assert.equal(await pg.get(a, p.id), null);
  assert.deepEqual((await pg.get(a, p.id, { draft: true }))!.files, {
    "index.tsx": code("v1"),
    "components/card.tsx": code("card"),
  });
  const v1 = await pg.publish(a, p.id);
  assert.equal(v1!.currentVersion, 1);
  assert.equal(v1!.hasDraft, false);

  // Isolation per workspace.
  assert.equal(await pg.get(b, p.id), null);
  assert.equal(
    await pg.patchFiles(b, p.id, [
      { op: "write", path: "index.tsx", source: "x" },
    ]),
    null,
  );
  assert.deepEqual(await pg.versions(b, p.id), []);
  assert.equal((await pg.list(b)).length, 0);
  assert.equal(await pg.remove(b, p.id), false);

  // Editing a file in the draft: the published one does not move.
  const w = await pg.patchFiles(a, p.id, [
    { op: "write", path: "index.tsx", source: code("v2") },
  ]);
  assert.equal(w!.hasDraft, true);
  assert.equal(w!.currentVersion, 1);
  assert.equal((await pg.get(a, p.id))!.files["index.tsx"], code("v1"));
  await pg.patchFiles(a, p.id, [
    { op: "write", path: "lib/util.ts", source: "export const n = 1;" },
  ]);
  await pg.patchFiles(a, p.id, [
    { op: "rename", from: "components/card.tsx", to: "components/item.tsx" },
  ]);
  await pg.patchFiles(a, p.id, [{ op: "delete", path: "lib/util.ts" }]);
  const d = (await pg.get(a, p.id, { draft: true }))!;
  assert.deepEqual(Object.keys(d.files).sort(), [
    "components/item.tsx",
    "index.tsx",
  ]);
  assert.equal(
    (await pg.get(a, p.id))!.files["components/card.tsx"],
    code("card"),
  );

  // Renaming the entry follows it.
  const r = await pg.patchFiles(a, p.id, [
    { op: "rename", from: "index.tsx", to: "main.tsx" },
  ]);
  assert.equal(r!.entry, "main.tsx");

  const v2 = await pg.publish(a, p.id);
  assert.equal(v2!.currentVersion, 2);
  const pub = (await pg.get(a, p.id))!;
  assert.equal(pub.version, 2);
  assert.equal(pub.entry, "main.tsx");
  assert.equal(pub.files["main.tsx"], code("v2"));
  assert.deepEqual(pub.permissions, { objects: ["o1"] });

  // Discarding the draft: back to published.
  await pg.patchFiles(a, p.id, [
    { op: "write", path: "main.tsx", source: code("v3") },
  ]);
  const dis = await pg.discard(a, p.id);
  assert.equal(dis!.hasDraft, false);
  assert.equal(dis!.files["main.tsx"], code("v2"));

  // Restore: new published version, draft aligned.
  const rs = await pg.restore(a, p.id, 1);
  assert.equal(rs!.currentVersion, 3);
  assert.equal(rs!.entry, "index.tsx");
  assert.equal((await pg.get(a, p.id))!.files["index.tsx"], code("v1"));
  assert.equal(
    (await pg.get(a, p.id, { draft: true }))!.files["index.tsx"],
    code("v1"),
  );
  assert.deepEqual(
    (await pg.versions(a, p.id)).map((v) => v.version),
    [1, 2, 3],
  );
  assert.equal(await pg.restore(a, p.id, 99), null);

  // update: replaces the package, `publish` publishes immediately.
  const u = await pg.update(a, p.id, {
    name: "L2",
    files: { "index.tsx": code("v4") },
    publish: true,
  });
  assert.equal(u!.name, "L2");
  assert.equal(u!.currentVersion, 4);
  assert.deepEqual((await pg.get(a, p.id))!.files, { "index.tsx": code("v4") });

  assert.equal((await pg.list(a)).length, 1);
  assert.equal(await pg.remove(a, p.id), true);
  assert.equal(await pg.get(a, p.id, { draft: true }), null);
});

test("lucide icon: default, creation, update, refusal", async () => {
  const a = await owner("Icon");
  const files = { "index.tsx": code("x") };
  const p = await pg.create(a, { name: "P", files });
  assert.equal(p.icon, "layout-dashboard");
  const q = await pg.create(a, { name: "Q", icon: "ShoppingCart", files });
  assert.equal(q.icon, "shopping-cart");
  assert.equal((await pg.update(a, p.id, { icon: "users" }))!.icon, "users");
  await assert.rejects(pg.update(a, p.id, { icon: "nope" }), /Unknown/);
});

test("component error: recorded once while open", async () => {
  const { errorsService } = await import("../errors");
  const a = await owner("CompErr");
  const e = { page: crypto.randomUUID(), block: "app", message: "boom" };
  const first = await errorsService.reportComponent(a, e);
  const again = await errorsService.reportComponent(a, e);
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  const { items } = await errorsService.list(a, { source: "component" });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.message, "boom");
});

test("/p/[slug]: published TSX package compiled for the iframe, permissioned SDK calls", async () => {
  const a = await owner("Render");
  const p = await pg.create(a, {
    name: "TSX",
    files: {
      "index.tsx": `import { Hello } from "./hello";\nexport default () => <Hello />;`,
      "hello.tsx": `export const Hello = () => <p>bonjour</p>;`,
    },
    publish: true,
  });
  const out = await pg.bundle(a, p.id);
  assert.match(out.bundle, /bonjour/);
  assert.equal(out.sources.length, 2);
  assert.deepEqual(out.objects, []);
  assert.deepEqual(
    await pg.call(a, p.id, { method: "user", args: {} }, { user: { id: "u" } }),
    { id: "u" },
  );
  await assert.rejects(
    pg.call(a, p.id, { method: "query", args: { object: "deals" } }),
    /not allowed/,
  );
  await pg.update(a, p.id, { files: { "index.tsx": "export default (" } });
  await rejectsCode(pg.bundle(a, p.id, { draft: true }), "pages.compileFailed");
  await rejectsCode(pg.bundle(a, crypto.randomUUID()), "pages.notFound");
});
