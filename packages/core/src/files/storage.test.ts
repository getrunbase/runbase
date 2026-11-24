// File drivers: selection from the environment, S3 driver (mocked
// client, then real MinIO if S3_TEST_ENDPOINT answers), disk ->
// bucket migration, idempotent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { AppError } from "../errors/app-error";
import { s3Storage, type S3Config } from "./s3";
import { localStorage, memoryStorage, storageFromEnv } from "./storage";
import { migrateLocalFiles } from "./migrate";

const file = (s: string, type = "text/plain") => ({
  bytes: new Uint8Array(Buffer.from(s)),
  type,
});

test("storageFromEnv: local by default, incomplete s3 refused, unknown driver refused", () => {
  assert.ok(storageFromEnv({ FILES_DIR: "/tmp/x" }));
  assert.equal(
    storageFromEnv({ FILES_DRIVER: "local" }).signedGetUrl,
    undefined,
  );
  assert.throws(
    () => storageFromEnv({ FILES_DRIVER: "s3", S3_BUCKET: "b" }),
    (e: AppError) =>
      e.code === "platform.filesS3Config" &&
      e.message.includes("S3_ACCESS_KEY_ID"),
  );
  assert.throws(
    () => storageFromEnv({ FILES_DRIVER: "ftp" }),
    (e: AppError) => e.code === "platform.filesDriverUnknown",
  );
  const s3 = storageFromEnv({
    FILES_DRIVER: "s3",
    S3_BUCKET: "b",
    S3_ACCESS_KEY_ID: "k",
    S3_SECRET_ACCESS_KEY: "s",
  });
  assert.equal(typeof s3.signedGetUrl, "function");
});

const conf: S3Config = {
  endpoint: "http://s3.test",
  region: "auto",
  bucket: "files",
  accessKeyId: "k",
  secretAccessKey: "s",
};

test("s3 (mocked client): commands sent, 404 = missing", async () => {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const client = {
    send: async (cmd: {
      constructor: { name: string };
      input: Record<string, unknown>;
    }) => {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      if (cmd.input.Key === "ws/missing")
        throw Object.assign(new Error("nope"), { name: "NoSuchKey" });
      if (cmd.constructor.name === "GetObjectCommand")
        return {
          ContentType: "text/plain",
          Body: { transformToByteArray: async () => file("hi").bytes },
        };
      if (cmd.constructor.name === "HeadObjectCommand")
        return { ContentType: "text/plain" };
      return {};
    },
  } as unknown as S3Client;
  const s = s3Storage(conf, client);
  await s.put("ws/a", file("hi"));
  assert.deepEqual(sent[0], {
    name: "PutObjectCommand",
    input: {
      Bucket: "files",
      Key: "ws/a",
      Body: file("hi").bytes,
      ContentType: "text/plain",
    },
  });
  assert.equal(Buffer.from((await s.get("ws/a"))!.bytes).toString(), "hi");
  assert.equal(await s.get("ws/missing"), null);
  assert.deepEqual(await s.head("ws/a"), { type: "text/plain" });
  assert.equal(await s.head("ws/missing"), null);
  await s.remove("ws/a");
  assert.equal(sent.at(-1)!.name, "DeleteObjectCommand");
});

test("s3: short presigned URLs, signed type, size and disposition", async () => {
  const s = s3Storage(conf);
  const get = new URL(
    await s.signedGetUrl!("ws/1/a b.pdf", {
      name: "a b.pdf",
      type: "application/pdf",
      inline: true,
    }),
  );
  assert.equal(
    get.origin + get.pathname,
    "http://s3.test/files/ws/1/a%20b.pdf",
  );
  assert.equal(get.searchParams.get("X-Amz-Expires"), "60");
  assert.equal(
    get.searchParams.get("response-content-type"),
    "application/pdf",
  );
  assert.match(
    get.searchParams.get("response-content-disposition")!,
    /^inline;/,
  );
  const put = new URL(
    await s.signedPutUrl!("ws/1/x.txt", { type: "text/plain", size: 5 }),
  );
  assert.match(put.searchParams.get("X-Amz-SignedHeaders")!, /content-length/);
  assert.match(put.searchParams.get("X-Amz-SignedHeaders")!, /content-type/);
});

test("disk -> storage migration: copy, idempotent, dry-run without writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "files-migrate-"));
  const src = localStorage(root);
  await src.put("ws1/u1/a.txt", file("a"));
  await src.put("ws2/u2/b.png", file("b", "image/png"));
  const dest = memoryStorage();
  const dry = await migrateLocalFiles(root, dest, { dryRun: true });
  assert.equal(dry.copied, 2);
  assert.equal(await dest.head("ws1/u1/a.txt"), null);
  const r1 = await migrateLocalFiles(root, dest);
  assert.deepEqual([r1.copied, r1.skipped], [2, 0]);
  assert.deepEqual(await dest.head("ws2/u2/b.png"), { type: "image/png" });
  assert.equal(
    Buffer.from((await dest.get("ws1/u1/a.txt"))!.bytes).toString(),
    "a",
  );
  const r2 = await migrateLocalFiles(root, dest);
  assert.deepEqual([r2.copied, r2.skipped], [0, 2]);
  // The source disk is intact.
  assert.deepEqual((await readdir(join(root, "ws1/u1"))).sort(), [
    "a.txt",
    "a.txt.type",
  ]);
});

test("local: hand-written `.type` with a newline, type cleaned", async () => {
  const root = await mkdtemp(join(tmpdir(), "files-type-"));
  await mkdir(join(root, "ws1/u1"), { recursive: true });
  await writeFile(join(root, "ws1/u1/c.png"), "c");
  await writeFile(join(root, "ws1/u1/c.png.type"), "image/png\n");
  const src = localStorage(root);
  assert.equal((await src.get("ws1/u1/c.png"))!.type, "image/png");
  assert.deepEqual(await src.head("ws1/u1/c.png"), { type: "image/png" });
  const dest = memoryStorage();
  assert.equal((await migrateLocalFiles(root, dest)).copied, 1);
  assert.deepEqual(await dest.head("ws1/u1/c.png"), { type: "image/png" });
});

// Real MinIO: docker compose --profile files up -d minio
// S3_TEST_ENDPOINT=http://127.0.0.1:9000 (credentials minio / minio-secret).
const endpoint = process.env.S3_TEST_ENDPOINT;
const minioConf = (bucket: string): S3Config => ({
  endpoint: endpoint!,
  region: "us-east-1",
  bucket,
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "minio",
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "minio-secret",
});

test(
  "s3 (MinIO): put/get/head/remove and real presigned URLs",
  { skip: !endpoint },
  async () => {
    const c = minioConf(`t-${Date.now()}`);
    const client = new S3Client({
      region: c.region,
      endpoint: c.endpoint,
      forcePathStyle: true,
      credentials: c,
    });
    await client.send(new CreateBucketCommand({ Bucket: c.bucket }));
    const s = s3Storage(c);
    await s.put("ws/1/a.txt", file("bonjour"));
    assert.equal(
      Buffer.from((await s.get("ws/1/a.txt"))!.bytes).toString(),
      "bonjour",
    );
    assert.deepEqual(await s.head("ws/1/a.txt"), { type: "text/plain" });
    assert.equal(await s.get("ws/1/none"), null);
    const r = await fetch(
      await s.signedGetUrl!("ws/1/a.txt", {
        name: "a.txt",
        type: "text/plain",
        inline: false,
      }),
    );
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "bonjour");
    assert.match(r.headers.get("content-disposition")!, /^attachment;/);
    // Direct presigned upload: right size accepted, wrong size refused.
    const url = await s.signedPutUrl!("ws/1/b.txt", {
      type: "text/plain",
      size: 5,
    });
    const bad = await fetch(url, {
      method: "PUT",
      body: "toolong",
      headers: { "content-type": "text/plain" },
    }).catch(() => null);
    assert.notEqual(bad?.status, 200);
    const ok = await fetch(url, {
      method: "PUT",
      body: "hello",
      headers: { "content-type": "text/plain" },
    });
    assert.equal(ok.status, 200);
    assert.equal(
      Buffer.from((await s.get("ws/1/b.txt"))!.bytes).toString(),
      "hello",
    );
    await s.remove("ws/1/a.txt");
    assert.equal(await s.head("ws/1/a.txt"), null);
  },
);
