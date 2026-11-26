// Better Auth: email + password, sessions in the database.
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt, magicLink } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import * as schema from "../db/schema";
import { memberships, organizations, user, workspaces } from "../db/schema";
import { emailSender } from "../email";
import { track } from "../extensions";
import { attributionFromCookieHeader } from "./attribution";
import {
  magicLinkEmail,
  resetPasswordEmail,
  verifyEmailEmail,
} from "./magic-link-email";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { appUrl, authMethod, emailConfigured, env } from "../env";

export { db };

// Flag read on every request: signups closed unless SIGNUPS_ENABLED=true.
export const signupsEnabled = () => env().SIGNUPS_ENABLED;

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
    user: {
      create: {
        // Magic link without a name: derived from the email (business domain, otherwise
        // locale part). It also names the organization; editable later.
        before: async (u) => ({
          data: { ...u, name: u.name?.trim() || nameFromEmail(u.email) },
        }),
        // Each account gets its organization (owner) and a default workspace.
        after: async (user, ctx) => {
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
          // First-touch attribution (UTM, click IDs) from the signup request.
          const cookie = ctx?.headers?.get("cookie") ?? ctx?.request?.headers.get("cookie");
          await track("user.signed_up", {
            ...attributionFromCookieHeader(cookie),
            userId: user.id,
            organizationId,
          });
        },
      },
    },
  },
});
