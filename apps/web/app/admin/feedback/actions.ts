"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { auth } from "@runbase/core/auth";
import { feedbackService, isPlatformAdmin } from "@runbase/core/feedback";

export async function toggleFeedback(f: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isPlatformAdmin(session?.user.email))
    throw new Error((await getTranslations("settings.admin"))("forbidden"));
  await feedbackService.resolve(String(f.get("id")), f.get("resolved") === "1");
  revalidatePath("/admin/feedback");
}
