import { connection } from "next/server";
import { Suspense } from "react";
import { authMethod, emailConfigured } from "@runbase/core/env";
import { LoginForm } from "./login-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("login");

// Sign-in method read at runtime (AUTH_METHOD), not at build time.
export default async function LoginPage() {
  await connection();
  const method = authMethod();
  return (
    <Suspense>
      <LoginForm
        authMethod={method}
        canReset={method === "password" && emailConfigured()}
      />
    </Suspense>
  );
}
