import { liveStream, pageReadable } from "@getrunbase/core/components/live";
import { getTenant } from "@/lib/tenant";

// SDK live (useQuery): SSE of changed objects readable by the page
// `?page=<id>`, app session (cookie). `?objects=a,b` narrows further.
// `?draft=1`: draft permissions (builders, write scope).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { ctx } = await getTenant({ pages: true });
  const url = new URL(req.url);
  const readable = await pageReadable(ctx, url.searchParams.get("page") ?? "", {
    draft: url.searchParams.get("draft") === "1",
  }).catch(() => null); // draft without write scope: not found
  if (!readable) return new Response("Page not found", { status: 404 });
  const asked = url.searchParams.get("objects")?.split(",");
  const objects = asked ? readable.filter((o) => asked.includes(o)) : readable;
  return new Response(liveStream(ctx.workspaceId, objects, req.signal), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
