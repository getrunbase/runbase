// Attached file storages. Interface shared by all drivers:
// `local` (disk, FILES_DIR, self-host and dev), `s3` (S3-compatible: R2,
// MinIO, AWS) and `memory` (tests). Chosen by FILES_DRIVER.
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { appError } from "../errors/app-error";
import { s3Storage } from "./s3";

export type StoredFile = { bytes: Uint8Array; type: string };

// Direct download response: name and type forced in the header.
export type SignedGet = { name: string; type: string; inline: boolean };

export interface FileStorage {
  put(key: string, file: StoredFile): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  // Metadata without the bytes; null if missing.
  head(key: string): Promise<{ type: string } | null>;
  remove(key: string): Promise<void>;
  // Presigned URLs (remote drivers only): the browser reads or
  // uploads the bytes directly in the bucket, without going through the web.
  signedGetUrl?(key: string, opts: SignedGet): Promise<string>;
  signedPutUrl?(
    key: string,
    opts: { type: string; size: number },
  ): Promise<string>;
}

export function memoryStorage(): FileStorage {
  const files = new Map<string, StoredFile>();
  return {
    put: async (k, f) => void files.set(k, f),
    get: async (k) => files.get(k) ?? null,
    head: async (k) => {
      const f = files.get(k);
      return f ? { type: f.type } : null;
    },
    remove: async (k) => void files.delete(k),
  };
}

// Local disk: one file per key, MIME type in `<key>.type`.
export function localStorage(root: string): FileStorage {
  const path = (k: string) => {
    const p = resolve(root, k);
    if (!p.startsWith(resolve(root) + "/"))
      throw appError("files.invalidKey", "Invalid key");
    return p;
  };
  return {
    put: async (k, f) => {
      await mkdir(dirname(path(k)), { recursive: true });
      await writeFile(path(k), f.bytes);
      await writeFile(`${path(k)}.type`, f.type);
    },
    get: async (k) => {
      try {
        return {
          bytes: new Uint8Array(await readFile(path(k))),
          type: (await readFile(`${path(k)}.type`, "utf8")).trim(),
        };
      } catch {
        return null;
      }
    },
    head: async (k) => {
      try {
        if (!(await stat(path(k))).isFile()) return null;
        return { type: (await readFile(`${path(k)}.type`, "utf8")).trim() };
      } catch {
        return null;
      }
    },
    remove: async (k) => {
      await rm(path(k), { force: true });
      await rm(`${path(k)}.type`, { force: true });
    },
  };
}

const S3_VARS = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];

// Storage described by the environment (FILES_DRIVER, default `local`).
export function storageFromEnv(env = process.env): FileStorage {
  const driver = env.FILES_DRIVER || "local";
  if (driver === "memory") return memoryStorage();
  if (driver === "local")
    return localStorage(env.FILES_DIR ?? join(process.cwd(), ".data/files"));
  if (driver === "s3") {
    const missing = S3_VARS.filter((v) => !env[v]);
    if (missing.length)
      throw appError(
        "platform.filesS3Config",
        "S3 file storage is not configured: missing {vars}",
        { vars: missing.join(", ") },
      );
    return s3Storage({
      endpoint: env.S3_ENDPOINT || undefined,
      region: env.S3_REGION || "auto",
      bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    });
  }
  throw appError(
    "platform.filesDriverUnknown",
    "Unknown file driver {driver} (local or s3)",
    { driver },
  );
}
