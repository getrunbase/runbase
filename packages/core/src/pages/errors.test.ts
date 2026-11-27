// Integration test: page runtime errors, sourcemap remap,
// deduplication and expiry. Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { compilePackage } from "../components/compile";
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

const files = {
  "index.tsx": `import { boom } from "./lib/boom";\nexport default () => <p>{boom()}</p>;`,
  "lib/boom.ts": `export function boom(): string {\n  throw new Error("kaboom");\n}`,
};

// Stack as Chrome produces it for the bundle named runbase-page.js.
async function stackOf() {
  const r = await compilePackage(files, "index.tsx");
  const col = r.bundle!.indexOf("kaboom");
  const line = r.bundle!.slice(0, col).split("\n").length;
  const lineStart = r.bundle!.lastIndexOf("\n", col) + 1;
  // Column of the `throw` (1-based): start of the preceding expression.
  const at = r.bundle!.lastIndexOf("throw", col) - lineStart + 1;
  return `Error: kaboom\n    at boom (runbase-page.js:${line}:${at})`;
}

test("reported error: read by errors, source file:line, deduplicated", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const ctx = await owner("PageErrors");
  const page = await pg.create(ctx, { name: "P", files, publish: true });
  const stack = await stackOf();

  await pg.reportError(ctx, page.id, { message: "kaboom", stack });
  await pg.reportError(ctx, page.id, { message: "kaboom", stack });
  const errs = await pg.errors(ctx, page.id);
  assert.equal(errs.length, 1);
  assert.equal(errs[0]!.count, 2);
  assert.match(errs[0]!.location!, /^lib\/boom\.ts:2:\d+$/);
  // Published and draft kept separate.
  assert.deepEqual(await pg.errors(ctx, page.id, { draft: true }), []);
  await pg.reportError(ctx, page.id, { draft: true, message: "draft only" });
  assert.equal((await pg.errors(ctx, page.id, { draft: true })).length, 1);
});

test("expiry: an error seen more than 24 h ago disappears", async () => {
  const ctx = await owner("PageErrorsTtl");
  const page = await pg.create(ctx, { name: "P", files, publish: true });
  await pg.reportError(ctx, page.id, { message: "old" });
  await sql`update page_errors set last_seen = now() - interval '25 hours' where page_id = ${page.id}`;
  assert.deepEqual(await pg.errors(ctx, page.id), []);
  // Purged on the next report; the same error restarts from 1.
  await pg.reportError(ctx, page.id, { message: "old" });
  const errs = await pg.errors(ctx, page.id);
  assert.equal(errs.length, 1);
  assert.equal(errs[0]!.count, 1);
  const [row] =
    await sql`select count(*)::int as n from page_errors where page_id = ${page.id}`;
  assert.equal(row!.n, 1);
});

test("dedup: a later stack without component stack keeps the richer one", async () => {
  const ctx = await owner("PageErrorsRich");
  const page = await pg.create(ctx, { name: "P", files, publish: true });
  const stack = await stackOf();
  const rich = `${stack}\n\nComponent stack:\n    at Bad (runbase-page.js:1:1)`;
  await pg.reportError(ctx, page.id, { message: "kaboom", stack });
  await pg.reportError(ctx, page.id, { message: "kaboom", stack: rich });
  await pg.reportError(ctx, page.id, { message: "kaboom", stack });
  const errs = await pg.errors(ctx, page.id);
  assert.equal(errs.length, 1);
  assert.equal(errs[0]!.count, 3);
  assert.match(errs[0]!.stack!, /Component stack:/);
});
