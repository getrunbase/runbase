"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { AuthForm } from "@/components/auth-form";
import { AuthFooter } from "@/components/auth-shell";
import { signUpWithPassword } from "@/lib/auth-client";

// Password sign-up: the organization and the workspace are created by
// the core databaseHooks; invitations stay on /invitations.
export function SignupForm() {
  const query = useSearchParams().toString();
  const t = useTranslations("auth.login");
  const tp = useTranslations("auth.password");
  const schema = z
    .object({
      name: z.string().trim().min(1, tp("nameRequired")),
      email: z.email(t("invalidEmail")),
      password: z.string().min(8, tp("passwordTooShort")),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, {
      message: tp("passwordMismatch"),
      path: ["confirm"],
    });
  return (
    <AuthForm
      title={tp("signupTitle")}
      description={tp("signupDescription")}
      schema={schema}
      fields={[
        { name: "name", label: tp("name"), type: "text" },
        {
          name: "email",
          label: t("email"),
          type: "email",
          placeholder: t("emailPlaceholder"),
        },
        {
          name: "password",
          label: tp("password"),
          type: "password",
          autoComplete: "new-password",
        },
        { name: "confirm", label: tp("confirm"), type: "password" },
      ]}
      submitLabel={tp("signupSubmit")}
      onSubmit={({ name, email, password }) =>
        signUpWithPassword({ name, email, password }, tp)
      }
      footer={
        <AuthFooter
          question={tp("hasAccount")}
          label={tp("loginLink")}
          href={query ? `/login?${query}` : "/login"}
        />
      }
    />
  );
}
