import { filesService, inlineType } from "@runbase/core/files";
import { getTenant } from "@/lib/tenant";

// Download of an attached file, limited to the current workspace.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const { ctx } = await getTenant();
  const path = key.map(decodeURIComponent).join("/");
  try {
    // s3 driver: redirect to a short-lived presigned URL (bytes served
    // by the bucket, never by the web).
    const url = await filesService.downloadUrl(ctx, path);
    if (url)
      return new Response(null, {
        status: 302,
        headers: { location: url, "cache-control": "no-store" },
      });
    const f = await filesService.download(ctx, path);
    return new Response(Buffer.from(f.bytes), {
      headers: {
        "content-type": f.type,
        // Inline only for images and PDFs (see inlineType).
        "content-disposition": `${inlineType(f.type) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("File not found", { status: 404 });
  }
}
