// Workspace activity and paused state. The core only records activity and
// honours the paused flag (crons and triggers skip a paused workspace); the
// policy that decides when to pause belongs to extensions. Nothing pauses by
// default. These helpers run outside RLS: they are called by trusted code
// (request handlers after authentication, the worker, extensions).
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { workspaces } from "../db/schema";

// At most one write per workspace and per process in this window.
export const ACTIVITY_THROTTLE_MS = 60_000;
const lastTouch = new Map<string, number>();

// Records an activity and resumes the workspace if it was paused.
// Returns true when the workspace was paused and is now resumed.
export async function touchActivity(workspaceId: string): Promise<boolean> {
  const now = Date.now();
  const prev = lastTouch.get(workspaceId);
  if (prev !== undefined && now - prev < ACTIVITY_THROTTLE_MS) return false;
  if (lastTouch.size > 10_000) lastTouch.clear();
  lastTouch.set(workspaceId, now);
  try {
    const [row] = await db
      .update(workspaces)
      .set({ lastActiveAt: sql`now()`, pausedAt: null })
      .where(eq(workspaces.id, workspaceId))
      // The `returning` clause sees the new row: read the old flag in a subquery.
      .returning({
        wasPaused: sql<boolean>`(select paused_at is not null from workspaces w where w.id = ${workspaceId})`,
      });
    return row?.wasPaused ?? false;
  } catch (e) {
    lastTouch.delete(workspaceId);
    throw e;
  }
}

// Best-effort variant for request paths: an activity write never fails a call.
export function touchActivitySoon(workspaceId: string) {
  touchActivity(workspaceId).catch(() => {});
}

export async function isPaused(workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ pausedAt: workspaces.pausedAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return !!row?.pausedAt;
}

export async function pauseWorkspace(workspaceId: string) {
  await db
    .update(workspaces)
    .set({ pausedAt: sql`now()` })
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.pausedAt)));
}

export async function resumeWorkspace(workspaceId: string) {
  lastTouch.delete(workspaceId);
  await db
    .update(workspaces)
    .set({ pausedAt: null })
    .where(eq(workspaces.id, workspaceId));
}

// Active workspaces without activity since `before` (never active: by
// creation date). Input for an extension's pause policy.
export async function inactiveWorkspaces(before: Date) {
  return db
    .select({
      id: workspaces.id,
      organizationId: workspaces.organizationId,
      lastActiveAt: workspaces.lastActiveAt,
    })
    .from(workspaces)
    .where(
      and(
        isNull(workspaces.pausedAt),
        or(
          lt(workspaces.lastActiveAt, before),
          and(isNull(workspaces.lastActiveAt), lt(workspaces.createdAt, before)),
        ),
      ),
    );
}

// Tests: forget the throttle window.
export function resetActivityThrottle() {
  lastTouch.clear();
}
