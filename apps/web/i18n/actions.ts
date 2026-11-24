"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, isLocale } from "./config";

// App language switch: 1-year cookie, server render rerun.
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    maxAge: 365 * 24 * 3600,
    path: "/",
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
