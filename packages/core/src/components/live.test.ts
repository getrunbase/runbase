// Integration test: SDK live SSE and keyset pagination.
// Requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { pagesService } from "../pages";
import { liveStream, pageReadable } from "./live";
import { handleSdkCall, permissionsSchema } from "./sdk";

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

const obj = (ctx: TenantContext, slug: string) =>
  objectsService.create(ctx, {
    slug,
    name: slug,
    fields: [{ key: "name", label: "Name", type: "text" }],
  });

// Tab: reads the SSE stream, collects the announced objects.
function tab(workspaceId: string, objects: string[]) {
  const ac = new AbortController();
  const reader = liveStream(workspaceId, objects, ac.signal).getReader();
  const got: string[] = [];
  const dec = new TextDecoder();
  let ready!: () => void;
  const isReady = new Promise<void>((r) => (ready = r));
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({
        value: undefined,
        done: true,
      }));
      if (done) return;
      const s = dec.decode(value);
      if (s.startsWith(": ready")) ready();
      for (const m of s.matchAll(/^data: (.*)$/gm))
        got.push(...(JSON.parse(m[1]!) as { objects: string[] }).objects);
    }
  })();
  return { got, ready: isReady, close: () => ac.abort() };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!f() && Date.now() < end) await wait(20);
}

test("live: a change reaches the other tabs, filtered by object/workspace/permissions", async () => {
  const ctx = await owner("Live A");
  const other = await owner("Live B");
  const deals = await obj(ctx, "deals");
  const secret = await obj(ctx, "secret");
  const foreign = await obj(other, "deals");

  const page = await pagesService.create(ctx, {
    name: "Live",
    files: { "index.tsx": "export default () => null" },
    permissions: { objects: [deals.id] },
    publish: true,
  });
  const readable = await pageReadable(ctx, page.id);
  assert.deepEqual(readable, [deals.id], "page permissions");
  assert.equal(await pageReadable(other, page.id), null, "autre workspace");

  const a = tab(ctx.workspaceId, readable!);
  const b = tab(ctx.workspaceId, readable!);
  await Promise.all([a.ready, b.ready]);

  // Tab A edits: B (and A) receive the modified object.
  const r = await recordsService.upsert(ctx, {
    objectId: deals.id,
    data: { name: "x" },
  });
  await recordsService.update(ctx, r.record.id, { name: "y" });
  // Outside permissions and another workspace: nothing.
  await recordsService.upsert(ctx, {
    objectId: secret.id,
    data: { name: "s" },
  });
  await recordsService.upsert(other, {
    objectId: foreign.id,
    data: { name: "f" },
  });
  await until(() => b.got.length >= 2);
  await wait(200);
  assert.deepEqual(b.got, [deals.id, deals.id]);
  assert.deepEqual(a.got, [deals.id, deals.id]);
  a.close();
  b.close();
});

test("sdk: keyset pagination (after = next) and useAggregate", async () => {
  const ctx = await owner("Keyset");
  const deals = await obj(ctx, "deals");
  for (let i = 0; i < 5; i++)
    await recordsService.upsert(ctx, {
      objectId: deals.id,
      data: { name: `d${i}` },
    });
  const perms = permissionsSchema.parse({ objects: [deals.id] });
  const host = {};
  const ids: string[] = [];
  let after: string | undefined;
  for (let n = 0; n < 5; n++) {
    const p = (await handleSdkCall(
      ctx,
      perms,
      { method: "query", args: { object: deals.id, limit: 2, after } },
      host,
    )) as { rows: { id: string }[]; total: number; next: string | null };
    assert.equal(p.total, 5);
    ids.push(...p.rows.map((x) => x.id));
    if (!p.next) break;
    after = p.next;
  }
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5, "none duplicate");

  const agg = (await handleSdkCall(
    ctx,
    perms,
    {
      method: "aggregate",
      args: { object: deals.id, aggregate: [{ op: "count", as: "n" }] },
    },
    host,
  )) as { rows: { n: number }[] };
  assert.equal(Number(agg.rows[0]!.n), 5);
  await assert.rejects(
    handleSdkCall(
      ctx,
      permissionsSchema.parse({}),
      { method: "aggregate", args: { object: deals.id, aggregate: [] } },
      host,
    ),
    /not allowed/,
  );
});
