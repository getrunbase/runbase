import { can } from "@getrunbase/core/entitlements";

// "Powered by Runbase" badge: only on the live (published) view, never on
// drafts or render screenshots, never for the workspace builders who
// are working inside the app (owner/admin/member), and hidden when the organization has the
// `feat:hideBadge` entitlement. Self-host (no billing extension) allows
// every feature, so the badge stays hidden there by default.
export async function showBadge(
  ctx: { organizationId: string },
  opts: { draft: boolean; shot: boolean; builder?: boolean },
) {
  if (opts.draft || opts.shot || opts.builder) return false;
  return !(await can(ctx, "feat:hideBadge"));
}
