import { liveStream, pageReadable } from "@getrunbase/core/components/live";
import { getTenant } from "@/lib/tenant";
import { liveAccess } from "./target";

// SDK live (useQuery): SSE of changed objects readable by the page
// `?page=<id>`, app session (cookie). `?objects=a,b` narrows further.
// `?draft=1`: draft permissions (builders, write scope).
// Capture token (page.screenshot): 204 for its own page (no live updates
// during a capture, the stream would block networkidle), 403 otherwise.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { ctx, shot } = await getTenant({ pages: true, shot: true });
  const url = new URL(req.url);
  const page = url.searchParams.get("page") ?? "";
  const access = liveAccess(shot, page);
  if (access === "forbidden") return new Response("Forbidden", { status: 403 });
  if (access === "skip") return new Response(null, { status: 204 });
  const readable = await pageReadable(ctx, page, {
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
