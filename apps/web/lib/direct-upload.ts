// Direct browser -> bucket upload (s3 driver): the server signs
// a short-lived PUT URL per file (type and size signed), the browser
// sends the bytes there without going through the web. The bucket must allow PUT
// cross-origin from the app (CORS, see .env.example).
import type { FileMeta } from "@getrunbase/core/files";

export type FileInfo = { name: string; type: string; size: number };
export type UploadTarget = { file: FileMeta; url: string };

export const fileInfo = (f: File): FileInfo => ({
  name: f.name,
  type: f.type,
  size: f.size,
});

// PUT of each file to its URL; false if one fails (network, CORS,
// expired URL).
export async function putToBucket(targets: UploadTarget[], files: File[]) {
  const ok = await Promise.all(
    targets.map((t, i) =>
      fetch(t.url, {
        method: "PUT",
        body: files[i],
        headers: { "content-type": t.file.type },
      }).then(
        (r) => r.ok,
        () => false,
      ),
    ),
  );
  return ok.every(Boolean);
}
