// Lazy runtime chunk (tiptap, maplibre), relayed to the iframe through postMessage
// (the iframe CSP only allows inline scripts).
import { chunkScript, isChunk } from "@/lib/code-runtime";

export const runtime = "nodejs";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isChunk(id)) return new Response("not found", { status: 404 });
  return new Response(await chunkScript(id), {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
    },
  });
}
