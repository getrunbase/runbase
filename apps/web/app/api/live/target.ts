import { assertShot } from "@/lib/tenant";
import type { ShotClaims } from "@/lib/screenshot-token";

// Page the live stream may follow: a capture token only reaches its own page.
export function liveTarget(shot: ShotClaims | null, page: string) {
  try {
    assertShot(shot, page);
    return page;
  } catch {
    return null;
  }
}
