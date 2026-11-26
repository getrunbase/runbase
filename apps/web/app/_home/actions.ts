"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getTenant } from "@/lib/tenant";
import { onboardingCookie } from "./cookie";

// Hides the finished guided start on the home, for this workspace.
export async function dismissOnboarding() {
  const { ctx } = await getTenant();
  (await cookies()).set(onboardingCookie(ctx.workspaceId), "1", {
    maxAge: 365 * 24 * 3600,
    sameSite: "lax",
    httpOnly: true,
  });
  revalidatePath("/");
}
