import { can } from "@getrunbase/core/entitlements";

// "Powered by Runbase" badge: only on the live (published) view, never on
// drafts or render screenshots, and hidden when the organization has the
// `feat:hideBadge` entitlement. Self-host (no billing extension) allows
// every feature, so the badge stays hidden there by default.
export async function showBadge(
  ctx: { organizationId: string },
  opts: { draft: boolean; shot: boolean },
) {
  if (opts.draft || opts.shot) return false;
  return !(await can(ctx, "feat:hideBadge"));
}
