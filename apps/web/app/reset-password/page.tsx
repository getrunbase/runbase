import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { authMethod, emailConfigured } from "@runbase/core/env";
import { ResetPasswordForm } from "./reset-password-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("resetPassword");

// Password reset: password mode with a configured mail provider.
export default async function ResetPasswordPage() {
  await connection();
  if (authMethod() !== "password" || !emailConfigured()) redirect("/login");
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
