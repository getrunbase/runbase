// Files integration (DATABASE_URL): files.upload then read from a
// file field, isolation between workspaces, presigned URLs. s3 driver on
// MinIO if S3_TEST_ENDPOINT is set, otherwise in-memory storage.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { type TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { filesService, memoryStorage, setFileStorage, type FileMeta } from ".";
import { s3Storage, type S3Config } from "./s3";

const minioConf = (bucket: string): S3Config => ({
  endpoint: process.env.S3_TEST_ENDPOINT!,
  region: "us-east-1",
  bucket,
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "minio",
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "minio-secret",
});

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

const s3 = Boolean(process.env.S3_TEST_ENDPOINT);

test(`files (${s3 ? "s3/MinIO" : "memory"}): upload, file field, read, isolation`, async () => {
  // FILES_DIR pointed at an empty folder: the s3 driver must write nothing there.
  const filesDir = await mkdtemp(join(tmpdir(), "files-dir-"));
  process.env.FILES_DIR = filesDir;
  if (s3) {
    const c = minioConf(`it-${Date.now()}`);
    await new S3Client({
      region: c.region,
      endpoint: c.endpoint,
      forcePathStyle: true,
      credentials: c,
    }).send(new CreateBucketCommand({ Bucket: c.bucket }));
    setFileStorage(s3Storage(c));
  } else setFileStorage(memoryStorage());

  const ctx = await owner("files-it");
  const other = await owner("files-it-2");
  const meta = await filesService.upload(ctx, {
    name: "quote.pdf",
    type: "application/pdf",
    base64: Buffer.from("%PDF-1.4 quote").toString("base64"),
  });
  assert.ok(meta.key.startsWith(`${ctx.workspaceId}/`));

  const o = await objectsService.create(ctx, {
    slug: "doc",
    name: "Docs",
    fields: [{ key: "pj", label: "Attachments", type: "file" }],
  });
  const r = await recordsService.upsert(ctx, {
    objectId: o.id,
    data: { pj: [meta] },
  });
  const back = await recordsService.get(ctx, r.record.id);
  const [stored] = back.data.pj as FileMeta[];
  const f = await filesService.download(ctx, stored!.key);
  assert.equal(Buffer.from(f.bytes).toString(), "%PDF-1.4 quote");
  assert.equal(f.type, "application/pdf");
  assert.equal(f.name, "quote.pdf");

  // Another workspace reads neither the bytes nor a presigned URL.
  await assert.rejects(filesService.download(other, meta.key));
  await assert.rejects(filesService.downloadUrl(other, meta.key));
  await assert.rejects(
    filesService.downloadUrl(other, `${other.workspaceId}/../${meta.key}`),
  );

  if (s3) {
    const url = await filesService.downloadUrl(ctx, meta.key);
    const res = await fetch(url!);
    assert.equal(await res.text(), "%PDF-1.4 quote");
    assert.match(res.headers.get("content-disposition")!, /^inline;/);
    // Direct presigned upload, read back by the service.
    assert.equal(filesService.direct(), true);
    const up = await filesService.uploadUrl(ctx, {
      name: "note.txt",
      type: "text/plain",
      size: 4,
    });
    assert.ok(up.file.key.startsWith(`${ctx.workspaceId}/`));
    const put = await fetch(up.url, {
      method: "PUT",
      body: "memo",
      headers: { "content-type": "text/plain" },
    });
    assert.equal(put.status, 200);
    const n = await filesService.download(ctx, up.file.key);
    assert.equal(Buffer.from(n.bytes).toString(), "memo");
    assert.deepEqual(await readdir(filesDir), []);
  } else {
    assert.equal(await filesService.downloadUrl(ctx, meta.key), null);
    assert.equal(filesService.direct(), false);
    await assert.rejects(
      filesService.uploadUrl(ctx, { name: "a", size: 1 }),
      /Direct upload is not available/,
    );
  }
  await assert.rejects(
    filesService.uploadUrl(ctx, { name: "big", size: 11 * 1024 * 1024 }),
  );
});
