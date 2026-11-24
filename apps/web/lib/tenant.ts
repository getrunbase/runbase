import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@getrunbase/core/auth";
import { apiKeyContext } from "@getrunbase/core/api-keys";
import { appError } from "@getrunbase/core/errors";
import { pendingInvitations } from "@getrunbase/core/members";
import {
  resolveUserContext,
  resolveUserSessionCached,
} from "@getrunbase/core/tenant";
import {
  SHOT_HEADER,
  verifyShotToken,
  type ShotClaims,
} from "./screenshot-token";

export const WORKSPACE_COOKIE = "workspace";

// Better Auth session: a single call per render (layout, pages, getTenant).
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

// User context, role and workspaces: at most one query per
// render (React cache, shared between layout and page) and a short TTL in the core.
export const userSession = cache(async (userId: string) =>
  resolveUserSessionCached(
    userId,
    (await cookies()).get(WORKSPACE_COOKIE)?.value,
  ),
);

// Session tenant context: current workspace read from a cookie.
// No organization but a pending invitation: invitations page.
// End user: pages only (`pages: true`, /p routes).
// Capture token (header): accepted only by callers that
// ask for it (`shot: true`, /p/* routes), read-only access to its page; refused
// everywhere else.
export async function getTenant(
  opts: { shot?: boolean; pages?: boolean } = {},
) {
  const h = await headers();
  const token = h.get(SHOT_HEADER);
  if (token) {
    if (!opts.shot)
      throw appError("web.shotDenied", "Capture token: access denied");
    const shot = verifyShotToken(token);
    const ctx =
      shot &&
      (shot.key
        ? await apiKeyContext(shot.key, shot.ws)
        : shot.user
          ? await resolveUserContext(shot.user, shot.ws)
          : null);
    if (!shot || !ctx)
      throw appError("web.shotInvalid", "Invalid capture token");
    const id = shot.user ?? `api_key:${shot.key}`;
    const user = { id, name: "", email: "" };
    return { session: { user } as never as Session, ctx, shot, role: null };
  }
  const session = await getSession();
  if (!session) redirect("/login");
  const us = await userSession(session.user.id);
  if (!us) {
    if ((await pendingInvitations(session.user.id)).length)
      redirect("/invitations");
    throw appError("web.noOrganization", "No organization");
  }
  const { ctx, role } = us;
  if (!opts.shot && !opts.pages && role === "end_user") redirect("/p");
  return { session, ctx, shot: null as ShotClaims | null, role };
}

type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

// Capture: only the token's page is readable, no mutation.
export function assertShot(
  shot: ShotClaims | null,
  pageId: string,
  write = false,
) {
  if (shot && (write || shot.page !== pageId))
    throw appError(
      "web.shotReadOnly",
      "Capture: read-only access to the requested page",
    );
}
