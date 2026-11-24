"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { z } from "zod";
import type { AuthMethod } from "@getrunbase/core/env";
import { AuthForm } from "@/components/auth-form";
import { AuthFooter } from "@/components/auth-shell";
import { sendMagicLink, signInWithPassword } from "@/lib/auth-client";

export function LoginForm({
  authMethod,
  canReset,
}: {
  authMethod: AuthMethod;
  canReset: boolean;
}) {
  const params = useSearchParams();
  const expired = params.get("error");
  const t = useTranslations("auth.login");
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
