// Orphan render PNGs: the web reads then deletes each shot, but when it gives
// up first (render timeout, reviewPage dropping a late result) nobody reads
// the keys. The renderer tracks every key it writes and this sweeper deletes
// the ones still there after `ttlMs`. Removing an already-read key is a no-op.
// Keys written before a renderer restart are not tracked.
import type { FileStorage } from "../files";

export const RENDER_KEY_TTL_MS = 5 * 60_000;

export function renderSweeper(
  storage: () => FileStorage,
  ttlMs = RENDER_KEY_TTL_MS,
  now = Date.now,
) {
  const written = new Map<string, number>();
  return {
    track: (key: string) => void written.set(key, now()),
    size: () => written.size,
    // Deletes expired keys; returns how many were swept.
    sweep: async () => {
      const limit = now() - ttlMs;
      let n = 0;
      for (const [key, at] of written) {
        if (at > limit) continue;
        try {
          await storage().remove(key);
          written.delete(key);
          n++;
        } catch {
          // Kept for the next sweep.
        }
      }
      return n;
    },
  };
}
