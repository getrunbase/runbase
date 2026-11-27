import { assertShot } from "@/lib/tenant";
import type { ShotClaims } from "@/lib/screenshot-token";

// What the live endpoint does for a request. A capture never needs live
// updates, and an open SSE stream would keep the renderer's networkidle
// wait from settling, so a capture of its own page gets "skip" (204, which
// EventSource does not retry). A capture token only reaches its own page.
export function liveAccess(
  shot: ShotClaims | null,
  page: string,
): "stream" | "skip" | "forbidden" {
  if (!shot) return "stream";
  try {
    assertShot(shot, page);
    return "skip";
  } catch {
    return "forbidden";
  }
}
