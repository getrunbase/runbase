// Better Auth: email + password, sessions in the database.
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt, magicLink } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import * as schema from "../db/schema";
import {
  account as accountTable,
  memberships,
  organizations,
  user,
  workspaces,
} from "../db/schema";
import { emailSender } from "../email";
import { track } from "../extensions";
import {
  magicLinkEmail,
  resetPasswordEmail,
  verifyEmailEmail,
} from "./magic-link-email";
import { and, eq } from "drizzle-orm";

import { db } from "../db/client";
import {
  appUrl,
  authMethod,
  emailConfigured,
  env,
  googleSignInConfigured,
} from "../env";

export { db };

// Flag read on every request: signups closed unless SIGNUPS_ENABLED=true.
export const signupsEnabled = () => env().SIGNUPS_ENABLED;

// Signups closed: an OAuth callback (Sign in with Google) must not create a
// new user. Existing accounts, invitees included (their user row is created
// by the invitation), are linked or signed in instead.
// Linking Google to an unverified account that has a password would hand
// the address to whoever set that password: refused. Invitees (no password)
// and verified accounts are linked.
export async function googleLinkBlocked(userId: string) {
  const [u] = await db
    .select({ verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId));
  if (!u || u.verified) return false;
  const [pw] = await db
    .select({ id: accountTable.id })
    .from(accountTable)
    .where(
      and(
        eq(accountTable.userId, userId),
        eq(accountTable.providerId, "credential"),
      ),
    )
    .limit(1);
  return !!pw;
}

export function oauthSignupBlocked(path: string | undefined) {
  return !signupsEnabled() && !!path?.startsWith("/callback");
}

// MCP protected resource: audience of OAuth tokens.
const baseURL = appUrl();
export const mcpResource = `${baseURL}/api/mcp`;
export const MCP_SCOPES = ["read", "write", "admin"] as const;

// ponytail: short list of webmail domains, extend if needed.
const WEBMAILS =
  /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail|orange|free|sfr|laposte|wanadoo)\./;
export function nameFromEmail(email: string) {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  const base = WEBMAILS.test(domain) ? local : domain.split(".")[0]!;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

async function userExists(email: string) {
  const [u] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()));
  return !!u;
}

// Sign-in method (AUTH_METHOD), fixed at server startup.
const method = authMethod();
const passwordMode = method === "password";
const google = googleSignInConfigured();

export const auth = betterAuth({
  baseURL,
  // The JWT plugin must not issue session JWTs (key shared with OAuth tokens).
  disabledPaths: ["/token"],
  // Session in a signed cookie (5 min): avoids a database query per getSession call.
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  plugins: [
    jwt({ disableSettingJwtHeader: true }),
    ...(passwordMode
      ? []
      : [
          magicLink({
            expiresIn: 15 * 60,
            // Language: NEXT_LOCALE cookie then the request's Accept-Language, default en.
            // Signups closed and unknown address: nothing is sent, but the
            // response stays 200 so the endpoint does not reveal accounts.
            sendMagicLink: async ({ email, url }) => {
              if (!signupsEnabled() && !(await userExists(email))) return;
              await emailSender().send({
                to: [email],
                ...magicLinkEmail(url),
              });
            },
          }),
        ]),
    // Connection bound to the account: the workspace is chosen per MCP tool call.
    mcp({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      resource: mcpResource,
      scopes: ["openid", "profile", "offline_access", ...MCP_SCOPES],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // CLI clients (Claude Code): loopback http redirect, classified as "native".
      clientRegistrationDefaultApplicationType: "infer",
    }),
  ],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Sign in with Google: only when a Google OAuth client is configured
  // (the same client as the Google connectors). Non-sensitive scopes only.
  socialProviders: google
    ? {
        google: {
          clientId: env().OAUTH_GOOGLE_CLIENT_ID!,
          clientSecret: env().OAUTH_GOOGLE_CLIENT_SECRET!,
          scope: ["openid", "email", "profile"],
          prompt: "select_account",
        },
      }
    : undefined,
  // Same verified Google email as an existing account: linked, not duplicated,
  // even when the local email is unverified (invitees). The one unsafe case,
  // an unverified account that has a password (someone may have pre-claimed
  // the address), is refused by the account creation hook below.
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      requireLocalEmailVerified: false,
    },
  },
  // AUTH_METHOD=magic-link (default): magic link by email, signup
  // included. AUTH_METHOD=password: email + password; reset by email
  // only if a mail provider is configured.
  // Password mode: the address must be verified before signing in
  // (otherwise anyone could claim an invited address). Without a mail
  // provider, only the bootstrap account can sign up (see the hook).
  emailVerification:
    passwordMode && emailConfigured()
      ? {
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
          sendVerificationEmail: async ({ user: u, url }) => {
            await emailSender().send({
              to: [u.email],
              ...verifyEmailEmail(url),
            });
          },
        }
      : undefined,
  emailAndPassword: {
    enabled: passwordMode,
    minPasswordLength: 8,
    requireEmailVerification: passwordMode && emailConfigured(),
    ...(passwordMode && emailConfigured()
      ? {
          sendResetPassword: async ({ user: u, url }) => {
            await emailSender().send({
              to: [u.email],
              ...resetPasswordEmail(url),
            });
          },
        }
      : {}),
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Signups closed: password signup refused; magic links are only sent
      // to existing accounts (see sendMagicLink), invitees included.
      if (ctx.path === "/sign-up/email" && !signupsEnabled())
        throw new APIError("FORBIDDEN", { message: "Sign-ups are closed" });
      // Without a mail provider, addresses cannot be verified: only the
      // first account (instance bootstrap) may sign up with a password.
      if (
        ctx.path === "/sign-up/email" &&
        !emailConfigured() &&
        (await db.select({ id: user.id }).from(user).limit(1)).length
      )
        throw new APIError("FORBIDDEN", {
          message: "Sign-ups require a configured email provider",
        });
    }),
  },
  databaseHooks: {
    account: {
      create: {
        before: async (a) => {
          if (a.providerId === "google" && (await googleLinkBlocked(a.userId)))
            throw new APIError("FORBIDDEN", {
              code: "account_not_linked",
              message: "Sign in with your password first",
            });
          return { data: a };
        },
      },
    },
    user: {
      create: {
        // Magic link without a name: derived from the email (business domain, otherwise
        // locale part). It also names the organization; editable later.
        before: async (u, ctx) => {
          if (oauthSignupBlocked(ctx?.path))
            throw new APIError("FORBIDDEN", {
              code: "signup_disabled",
              message: "Sign-ups are closed",
            });
          return {
            data: { ...u, name: u.name?.trim() || nameFromEmail(u.email) },
          };
        },
        // Each account gets its organization (owner) and a default workspace.
        after: async (user) => {
          const organizationId = await db.transaction(async (tx) => {
            const [org] = await tx
              .insert(organizations)
              .values({ name: user.name })
              .returning();
            await tx
              .insert(workspaces)
              .values({ organizationId: org!.id, name: "Default" });
            await tx.insert(memberships).values({
              userId: user.id,
              organizationId: org!.id,
              role: "owner",
            });
            return org!.id;
          });
          // Product analytics (no-op without extension): never the email or name.
          await track("user.signed_up", { userId: user.id, organizationId });
        },
      },
    },
  },
});
