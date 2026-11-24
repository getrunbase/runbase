// UI locales. `en` = default locale.
export const locales = ["en", "fr"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

// One JSON file per namespace and per locale: messages/<locale>/<ns>.json.
// New namespace: create both files and add it here.
export const namespaces = [
  "common",
  "auth",
  "nav",
  "home",
  "settings",
  "workflows",
  "objects",
  "databases",
  "pages",
  "interfaces",
  "runs",
  "functions",
  "webhooks",
] as const;

export const isLocale = (v: unknown): v is Locale =>
  locales.includes(v as Locale);

// Accept-Language -> first supported locale, otherwise the default.
export function negotiate(header: string | null | undefined): Locale {
  for (const part of (header ?? "").split(",")) {
    const tag = part.split(";")[0]!.trim().slice(0, 2).toLowerCase();
    if (isLocale(tag)) return tag;
  }
  return defaultLocale;
}
