// S3-compatible driver (Cloudflare R2, MinIO, AWS S3). Nothing is written to
// disk: bytes and MIME type live in the object. Presigned URLs
// are short-lived (SIGNED_TTL_S): a leaked link expires quickly.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FileStorage } from "./storage";

export const SIGNED_TTL_S = 60;

export type S3Config = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const missing = (e: unknown) => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err.name === "NoSuchKey" ||
    err.name === "NotFound" ||
    err.$metadata?.httpStatusCode === 404
  );
};

export function s3Storage(c: S3Config, client?: S3Client): FileStorage {
  const s3 =
    client ??
    new S3Client({
      region: c.region,
      endpoint: c.endpoint,
      // MinIO and most S3-compatible stores: bucket in the path.
      forcePathStyle: Boolean(c.endpoint),
      credentials: {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
      },
    });
  const Bucket = c.bucket;
  return {
    put: async (Key, f) => {
      await s3.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: f.bytes,
          ContentType: f.type,
        }),
      );
    },
    get: async (Key) => {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
        return {
          bytes: await r.Body!.transformToByteArray(),
          type: r.ContentType ?? "application/octet-stream",
        };
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    head: async (Key) => {
      try {
        const r = await s3.send(new HeadObjectCommand({ Bucket, Key }));
        return {
          type: r.ContentType ?? "application/octet-stream",
          size: r.ContentLength ?? 0,
        };
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    remove: async (Key) => {
      await s3.send(new DeleteObjectCommand({ Bucket, Key }));
    },
    signedGetUrl: (Key, o) =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket,
          Key,
          ResponseContentType: o.type,
          ResponseContentDisposition: `${o.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(o.name)}`,
        }),
        { expiresIn: SIGNED_TTL_S },
      ),
    // Signed type and size: the upload must match them to the byte.
    signedPutUrl: (Key, o) =>
      getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket,
          Key,
          ContentType: o.type,
          ContentLength: o.size,
        }),
        { expiresIn: SIGNED_TTL_S, signableHeaders: new Set(["content-type"]) },
      ),
  };
}
