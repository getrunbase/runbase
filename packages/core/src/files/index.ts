// Attached files (`file` field): bytes in a swappable storage,
// the field value only keeps { key, name, size, type }. The key starts
// with the workspace id: a file can only be read from its workspace.
// Storages (FILES_DRIVER): `local` (disk, FILES_DIR) by default, `s3`
// (S3-compatible, presigned URLs), `memory` (tests). See ./storage.
import { appError, notFound } from "../errors/app-error";
import { randomUUID } from "node:crypto";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { withTenant, type TenantContext } from "../tenant";
import { storageFromEnv, type FileStorage } from "./storage";

export {
  localStorage,
  memoryStorage,
  storageFromEnv,
  type FileStorage,
  type StoredFile,
} from "./storage";

let current: FileStorage | undefined;
export function setFileStorage(s: FileStorage) {
  current = s;
}
export function fileStorage() {
  current ??= storageFromEnv();
  return current;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export type FileMeta = {
  key: string;
  name: string;
  size: number;
  type: string;
};

// Displayed in the browser only for images and PDFs: an uploaded HTML or
// SVG never runs on our domain (nor the bucket's).
const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;
export const inlineType = (type: string) => INLINE.test(type);

// No `..` or empty segment: the key must not escape the workspace.
function ownKey(ctx: TenantContext, key: string) {
  const parts = key.split("/");
  if (
    parts[0] !== ctx.workspaceId ||
    parts.some((p) => p === "" || p === "." || p === "..")
  )
    throw notFound("files.notFound", "File not found");
  return parts.at(-1)!;
}

function newMeta(
  ctx: TenantContext,
  input: { name: string; type?: string },
  size: number,
): FileMeta {
  if (!size) throw appError("files.empty", "Empty file");
  if (size > MAX_FILE_BYTES)
    throw appError("files.tooLarge", "File too large (10 MB maximum)");
  const name = input.name.replace(/[/\\]/g, "_").slice(0, 200) || "file";
  return {
    key: `${ctx.workspaceId}/${randomUUID()}/${name}`,
    name,
    size,
    type: input.type || "application/octet-stream",
  };
}

const logUpload = (ctx: TenantContext, meta: FileMeta) =>
  withTenant(ctx, (tx) =>
    audit(tx, ctx, "file.upload", { type: "file", id: meta.key }, meta),
  );

export const filesService = {
  // Uploads a file; returns the value to put in a `file` field.
  upload: async (
    ctx: TenantContext,
    input: { name: string; type?: string; base64?: string; bytes?: Uint8Array },
  ): Promise<FileMeta> => {
    await requireScope(ctx, "write");
    const bytes =
      input.bytes ?? new Uint8Array(Buffer.from(input.base64 ?? "", "base64"));
    const meta = newMeta(ctx, input, bytes.length);
    await fileStorage().put(meta.key, { bytes, type: meta.type });
    await logUpload(ctx, meta);
    return meta;
  },
  // Does the storage accept direct upload (presigned PUT URL)? The web
  // uses it to avoid routing the bytes through itself with the s3 driver.
  direct: () => Boolean(fileStorage().signedPutUrl),
  // Direct browser -> bucket upload (s3 driver): short presigned PUT URL,
  // signed type and size. Also returns the `file` field value.
  uploadUrl: async (
    ctx: TenantContext,
    input: { name: string; type?: string; size: number },
  ): Promise<{ file: FileMeta; url: string }> => {
    await requireScope(ctx, "write");
    const s = fileStorage();
    if (!s.signedPutUrl)
      throw appError(
        "platform.filesDirectUnsupported",
        "Direct upload is not available with this file storage",
      );
    const file = newMeta(ctx, input, input.size);
    const url = await s.signedPutUrl(file.key, file);
    await logUpload(ctx, file);
    return { file, url };
  },
  download: async (ctx: TenantContext, key: string) => {
    await requireScope(ctx, "read");
    const name = ownKey(ctx, key);
    const file = await fileStorage().get(key);
    if (!file) throw notFound("files.notFound", "File not found");
    return { ...file, name };
  },
  // Short presigned GET URL (s3 driver), null if the storage does not provide
  // one (local: bytes go through the web).
  downloadUrl: async (
    ctx: TenantContext,
    key: string,
  ): Promise<string | null> => {
    await requireScope(ctx, "read");
    const name = ownKey(ctx, key);
    const s = fileStorage();
    if (!s.signedGetUrl) return null;
    const head = await s.head(key);
    if (!head) throw notFound("files.notFound", "File not found");
    return s.signedGetUrl(key, {
      name,
      type: head.type,
      inline: inlineType(head.type),
    });
  },
};
