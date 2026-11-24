import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export const authClient = createAuthClient({
  plugins: [oauthProviderClient(), magicLinkClient()],
});

// Return after clicking the magic link. MCP OAuth flow (signed `sig` request):
// we replay /oauth2/authorize, which resumes the flow now that the session
// exists. Otherwise `next` (internal path only) or home.
export function magicLinkCallback(search: string) {
  const q = new URLSearchParams(search);
  if (q.has("sig")) {
    for (const k of ["sig", "ba_param", "ba_iat", "ba_pl"]) q.delete(k);
    return `/api/auth/oauth2/authorize?${q}`;
  }
  const next = q.get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}

// Sends the magic link; returns the message to display (translated by `t`,
// `auth.login` sub-namespace).
type MagicLinkKey = "closed" | "sendFailed" | "sent";
export async function sendMagicLink(
  email: string,
  t: (key: MagicLinkKey, values?: { email: string }) => string,
) {
  const { error } = await authClient.signIn.magicLink({
    email,
    callbackURL: magicLinkCallback(window.location.search),
    errorCallbackURL: "/login?error=lien",
  });
  if (error)
    return error.status === 403
      ? t("closed")
      : (error.message ?? t("sendFailed"));
  return t("sent", { email });
}

// Password mode (AUTH_METHOD=password): messages translated by `t`
// (`auth.password` sub-namespace). Success: same follow-up as the magic link
// (resume the MCP OAuth flow, otherwise `next` or home).
type PasswordKey = "invalidCredentials" | "closed" | "exists" | "failed";
type PasswordError = { status: number; code?: string; message?: string };
function passwordError(error: PasswordError, t: (key: PasswordKey) => string) {
  if (error.status === 401) return t("invalidCredentials");
  if (error.status === 403) return t("closed");
  if (error.status === 422 || error.code?.startsWith("USER_ALREADY_EXISTS"))
    return t("exists");
  return error.message ?? t("failed");
}

export async function signInWithPassword(
  email: string,
  password: string,
  t: (key: PasswordKey) => string,
) {
  const { error } = await authClient.signIn.email({ email, password });
  if (error) return passwordError(error, t);
  window.location.href = magicLinkCallback(window.location.search);
}

export async function signUpWithPassword(
  v: { name: string; email: string; password: string },
  t: (key: PasswordKey) => string,
) {
  const { error } = await authClient.signUp.email(v);
  if (error) return passwordError(error, t);
  window.location.href = magicLinkCallback(window.location.search);
}

// The OAuth endpoints (sign-in during a flow, continue, consent) return the next URL.
export function followOAuth(data: unknown) {
  const url = (data as { url?: string } | null)?.url;
  if (url) window.location.href = url;
  return !!url;
}
