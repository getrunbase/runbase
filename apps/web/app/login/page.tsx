import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { authMethod, emailConfigured } from "@getrunbase/core/env";
import { LoginForm } from "./login-form";
import { pageTitle } from "@/lib/page-title";
import { getSession } from "@/lib/tenant";

export const generateMetadata = pageTitle("login");

// Sign-in method read at runtime (AUTH_METHOD), not at build time.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  // Already signed in: leave /login (the layout already renders the app shell).
  // Any other parameter means an OAuth flow, which the form must continue.
  const { next, ...rest } = await searchParams;
  if (Object.keys(rest).length === 0 && (await getSession())) {
    const target = typeof next === "string" ? next : "/";
    redirect(/^\/(?![/\\])/.test(target) ? target : "/");
  }
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
