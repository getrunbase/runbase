// Integration test: requires DATABASE_URL (Postgres started as a service in CI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";

test("migrations apply and the healthcheck table is usable", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const [row] =
      await sql`insert into healthcheck default values returning id`;
    assert.ok(row?.id);
  } finally {
    await sql.end();
  }
});

test("tenant schema: active FKs between organizations, workspaces and memberships", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const [org] =
      await sql`insert into organizations (name) values ('acme') returning id`;
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'crm')`;
    const uid = crypto.randomUUID();
    await sql`insert into "user" (id, name, email) values (${uid}, 'a', ${uid + "@x.io"})`;
    await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
    await assert.rejects(
      sql`insert into workspaces (organization_id, name) values (${crypto.randomUUID()}, 'x')`,
      /foreign key/,
    );
    await assert.rejects(
      sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'guest')`,
    );
  } finally {
    await sql.end();
  }
});
