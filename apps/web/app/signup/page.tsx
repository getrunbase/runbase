import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { authMethod } from "@runbase/core/env";
import { SignupForm } from "./signup-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("signup");

// Magic link: sign-up and sign-in on the same page (/login).
// Password (AUTH_METHOD=password): dedicated sign-up form.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await connection();
  if (authMethod() !== "password") {
    const q = new URLSearchParams(await searchParams).toString();
    redirect(q ? `/login?${q}` : "/login");
  }
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
