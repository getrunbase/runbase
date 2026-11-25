// Texts of the docs site itself (layout, home, metadata, llms.txt), per
// language: messages/<lang>/site.json. Fumadocs UI texts (search, table of
// contents…) are English by default and translated in messages/fr/fumadocs.json.
import { defineI18nUI } from "fumadocs-ui/i18n";
import en from "@/messages/en/site.json";
import fr from "@/messages/fr/site.json";
import frUi from "@/messages/fr/fumadocs.json";
import { i18n, type Lang } from "./i18n";

// `satisfies`: a key missing in a language breaks `pnpm typecheck`.
const site = { en, fr } satisfies Record<Lang, typeof en>;

export const messages = (lang: Lang) => site[lang];

export const i18nUI = defineI18nUI(i18n, {
  en: { displayName: en.languageName },
  fr: { ...frUi, displayName: fr.languageName },
});
