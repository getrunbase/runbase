"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { AuthForm } from "@/components/auth-form";
import { AuthFooter } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";

// No token: request the link by email. With a token (link received): new password.
export function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const t = useTranslations("auth.login");
  const tp = useTranslations("auth.password");
  const footer = (
    <AuthFooter
      question={tp("hasAccount")}
      label={tp("loginLink")}
      href="/login"
    />
  );

  if (!token)
    return (
      <AuthForm
        title={tp("resetTitle")}
        description={
          params.get("error") ? tp("resetExpired") : tp("resetDescription")
        }
        schema={z.object({ email: z.email(t("invalidEmail")) })}
        fields={[
          {
            name: "email",
            label: t("email"),
            type: "email",
            placeholder: t("emailPlaceholder"),
          },
        ]}
        submitLabel={tp("resetSubmit")}
        onSubmit={async (v) => {
          const { error } = await authClient.requestPasswordReset({
            email: v.email,
            redirectTo: "/reset-password",
          });
          return error ? (error.message ?? tp("failed")) : tp("resetSent");
        }}
        footer={footer}
      />
    );

  return (
    <AuthForm
      title={tp("newPasswordTitle")}
      schema={z
        .object({
          password: z.string().min(8, tp("passwordTooShort")),
          confirm: z.string(),
        })
        .refine((v) => v.password === v.confirm, {
          message: tp("passwordMismatch"),
          path: ["confirm"],
        })}
      fields={[
        {
          name: "password",
          label: tp("newPassword"),
          type: "password",
          autoComplete: "new-password",
        },
        { name: "confirm", label: tp("confirm"), type: "password" },
      ]}
      submitLabel={tp("newPasswordSubmit")}
      onSubmit={async (v) => {
        const { error } = await authClient.resetPassword({
          newPassword: v.password,
          token,
        });
        if (error) return error.message ?? tp("failed");
        router.push("/login");
      }}
      footer={footer}
    />
  );
}
