// Docs languages (Fumadocs i18n): content/docs/<lang>/ (parser "dir"),
// English is the default and the fallback of every missing French page.
import { defineI18n } from "fumadocs-core/i18n";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./locale-path.mjs";

export type Lang = "en" | "fr";

export const i18n = defineI18n<Lang>({
  languages: LANGUAGES as Lang[],
  defaultLanguage: DEFAULT_LANGUAGE as Lang,
  hideLocale: "default-locale",
  parser: "dir",
  fallbackLanguage: DEFAULT_LANGUAGE as Lang,
});

export const isLang = (v: string): v is Lang =>
  (i18n.languages as string[]).includes(v);
