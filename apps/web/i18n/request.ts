import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  LOCALE_COOKIE,
  isLocale,
  namespaces,
  negotiate,
  type Locale,
} from "./config";

// Request locale: cookie > Accept-Language (no URL prefix).
export async function resolveLocale(): Promise<Locale> {
  const h = await headers();
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  return negotiate(h.get("accept-language"));
}

export async function loadMessages(locale: Locale) {
  const parts = await Promise.all(
    namespaces.map(
      async (ns) =>
        [ns, (await import(`../messages/${locale}/${ns}.json`)).default] as const,
    ),
  );
  return Object.fromEntries(parts);
}

export default getRequestConfig(async ({ locale: explicit }) => {
  const locale = isLocale(explicit) ? explicit : await resolveLocale();
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: "Europe/Paris",
  };
});
