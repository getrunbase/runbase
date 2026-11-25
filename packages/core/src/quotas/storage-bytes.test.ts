// Integration test: stored file bytes counter and quota:storageBytes.
// Requires DATABASE_URL.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { filesService, memoryStorage, setFileStorage } from "../files";
import { quotasService, storageBytesOf } from "./index";
import { invalidateEntitlements } from "../entitlements";
import { registerExtensions, resetExtensions } from "../extensions";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));
setFileStorage(memoryStorage());
afterEach(() => {
  resetExtensions();
  invalidateEntitlements();
});

async function owner(): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values ('S') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'S', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return { organizationId: org!.id, workspaceId: ws!.id, actor: { userId: uid } };
}

const cap = (ctx: TenantContext, n: number) => {
  registerExtensions({
    billing: {
      entitlements: async (org) =>
        org === ctx.organizationId
          ? { features: [], quotas: { "quota:storageBytes": n } }
          : null,
      reportUsage: async () => {},
    },
  });
  invalidateEntitlements();
};

const bytes = (n: number) => new Uint8Array(n).fill(1);

test("unlimited by default: upload counts bytes, delete frees them", async () => {
  const ctx = await owner();
  const a = await filesService.upload(ctx, { name: "a.bin", bytes: bytes(100) });
  await filesService.upload(ctx, { name: "b.bin", bytes: bytes(50) });
  assert.equal(await storageBytesOf(ctx.organizationId), 150);
  assert.equal((await quotasService.get(ctx)).usage.storageBytes, 150);
  await filesService.remove(ctx, a.key);
  assert.equal(await storageBytesOf(ctx.organizationId), 50);
  await assert.rejects(filesService.remove(ctx, a.key), { code: "files.notFound" });
});

test("quota:storageBytes caps the organization, all workspaces summed", async () => {
  const ctx = await owner();
  const [ws2] =
    await sql`insert into workspaces (organization_id, name) values (${ctx.organizationId}, 'Second') returning id`;
  const ctx2 = { ...ctx, workspaceId: ws2!.id as string };
  cap(ctx, 100);
  await filesService.upload(ctx, { name: "a.bin", bytes: bytes(60) });
  await assert.rejects(
    filesService.upload(ctx2, { name: "b.bin", bytes: bytes(41) }),
    { status: 429, code: "quotas.storageBytes", message: /100 bytes/ },
  );
  const b = await filesService.upload(ctx2, { name: "b.bin", bytes: bytes(40) });
  assert.equal(await storageBytesOf(ctx.organizationId), 100);
  await filesService.remove(ctx2, b.key);
  await filesService.upload(ctx, { name: "c.bin", bytes: bytes(40) });
  assert.equal(await storageBytesOf(ctx.organizationId), 100);
});

test("remove: another workspace's key is not found", async () => {
  const ctx = await owner();
  const other = await owner();
  const f = await filesService.upload(ctx, { name: "a.bin", bytes: bytes(10) });
  await assert.rejects(filesService.remove(other, f.key), { code: "files.notFound" });
  assert.equal(await storageBytesOf(ctx.organizationId), 10);
});
