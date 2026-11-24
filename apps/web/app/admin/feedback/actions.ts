"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { auth } from "@runbase/core/auth";
import { feedbackService, isPlatformAdmin } from "@runbase/core/feedback";
import { formInput, parseInput } from "@/lib/action-input";
import { toggleInput } from "./inputs";

export async function toggleFeedback(f: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isPlatformAdmin(session?.user.email))
    throw new Error((await getTranslations("settings.admin"))("forbidden"));
  const { id, resolved } = parseInput(toggleInput, formInput(f));
  await feedbackService.resolve(id, resolved);
  revalidatePath("/admin/feedback");
}
