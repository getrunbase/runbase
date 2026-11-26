"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { z } from "zod";
import type { AuthMethod } from "@getrunbase/core/env";
import { AuthForm } from "@/components/auth-form";
import { AuthFooter } from "@/components/auth-shell";
import { GoogleButton } from "@/components/google-button";
import {
  googleErrorKey,
  sendMagicLink,
  signInWithPassword,
} from "@/lib/auth-client";

export function LoginForm({
  authMethod,
  canReset,
  google,
}: {
  authMethod: AuthMethod;
  canReset: boolean;
  // A Google OAuth client is configured (server-computed).
  google: boolean;
}) {
  const params = useSearchParams();
  const t = useTranslations("auth.login");
  // Failed Google sign-in (?google=1&error=...) vs expired magic link.
  const googleError = googleErrorKey(params);
  const expired = !googleError && params.get("error");
  const alternative = google && (
    <GoogleButton error={googleError && t(googleError)} />
  );
  const tp = useTranslations("auth.password");
  const email = {
    name: "email",
    label: t("email"),
    type: "email",
    placeholder: t("emailPlaceholder"),
  };

  if (authMethod === "magic-link")
    return (
      <AuthForm
        title={t("title")}
        description={expired ? t("expired") : t("description")}
        schema={z.object({ email: z.email(t("invalidEmail")) })}
        fields={[email]}
        submitLabel={t("submit")}
        onSubmit={(v) => sendMagicLink(v.email, t)}
        alternative={alternative}
      />
    );

  // The parameters (MCP OAuth flow, `next`) carry over to sign-up.
  const query = params.toString();
  return (
    <AuthForm
      title={t("title")}
      description={tp("loginDescription")}
      schema={z.object({
        email: z.email(t("invalidEmail")),
        password: z.string().min(1, tp("passwordRequired")),
      })}
      fields={[
        email,
        { name: "password", label: tp("password"), type: "password" },
      ]}
      submitLabel={tp("loginSubmit")}
      onSubmit={(v) => signInWithPassword(v.email, v.password, tp)}
      alternative={alternative}
      footer={
        <div className="flex flex-col items-center gap-2">
          <AuthFooter
            question={tp("noAccount")}
            label={tp("signupLink")}
            href={query ? `/signup?${query}` : "/signup"}
          />
          {canReset && (
            <AuthFooter
              question={tp("forgotQuestion")}
              label={tp("forgotLink")}
              href="/reset-password"
            />
          )}
        </div>
      }
    />
  );
}
