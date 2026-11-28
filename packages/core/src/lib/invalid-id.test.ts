// Integration test: non-uuid ids -> clean error, never a
// "Failed query" nor SQL / workspace_id in the message. Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { sql as dsql } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { eventsService } from "../events";
import { runsService } from "../runs";
import { AppError } from "../errors/app-error";

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

// Clean error: AppError with the expected code, without SQL or internal ids.
const clean =
  (ctx: TenantContext, code: string) =>
  (e: unknown): boolean => {
    assert.ok(e instanceof AppError, String(e));
    assert.equal(e.code, code);
    assert.doesNotMatch(e.message, /Failed query|select |params:/i);
    assert.ok(!e.message.includes(ctx.workspaceId));
    return true;
  };

test("non-uuid ids: records, events, runs, refs -> clean errors", async () => {
  const ctx = await owner("Invalid ids");
  const o = await objectsService.create(ctx, {
    slug: "deals",
    name: "Deals",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "parent", label: "Parent", type: "ref", object: "deals" },
    ],
  });

  await assert.rejects(
    recordsService.get(ctx, "0e877df1"),
    clean(ctx, "records.notFound"),
  );
  await assert.rejects(
    recordsService.update(ctx, "0e877df1", { name: "x" }),
    clean(ctx, "records.notFound"),
  );
  await assert.rejects(
    recordsService.upsert(ctx, {
      objectId: o.id,
      data: { name: "a", parent: "not-a-uuid" },
    }),
    // Rejected by schema validation (zod), before any query.
    (e: unknown) => {
      assert.match(String(e), /Invalid UUID/);
      assert.doesNotMatch(String(e), /Failed query/);
      return true;
    },
  );
  await assert.rejects(
    eventsService.insert(ctx, { type: "t", recordId: "0e877df1" }),
    clean(ctx, "records.notFound"),
  );
  assert.equal(await runsService.get(ctx, "0e877df1"), null);
  await assert.rejects(
    runsService.cancel(ctx, "0e877df1"),
    clean(ctx, "common.invalidId"),
  );
});

test("global safety net: pg error 22P02 in withTenant -> common.invalidValueOf", async () => {
  const ctx = await owner("22P02");
  await assert.rejects(
    withTenant(ctx, (tx) =>
      tx.execute(
        dsql`select * from records where id = ${"0e877df1"} and workspace_id = ${ctx.workspaceId}`,
      ),
    ),
    clean(ctx, "common.invalidValueOf"),
  );
});
