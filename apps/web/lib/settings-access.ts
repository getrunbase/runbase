// Who sees which Settings area. Mirrors the checks in the core services
// (requireScope / requireOwner), which stay the source of truth.
type Role = "owner" | "admin" | "member" | "viewer" | "end_user" | null;

// General, members, API keys, secrets, audit log, plan and billing.
export const isOrgAdmin = (role: Role) => role === "owner" || role === "admin";
// Usage: owners, admins and members (not viewers).
export const canSeeUsage = (role: Role) =>
  isOrgAdmin(role) || role === "member";
// Any Settings tab at all (sidebar entry, /settings).
export const canSeeSettings = canSeeUsage;
// First tab a role can open.
export const settingsHome = (role: Role) =>
  isOrgAdmin(role)
    ? "/settings/general"
    : canSeeUsage(role)
      ? "/settings/usage"
      : null;
