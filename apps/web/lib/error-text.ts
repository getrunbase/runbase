// Text of a core error in the UI language (see docs/i18n.md,
// "Errors and core"). The core produces a stable code + params + English
// message; French lives in messages/fr/errors/<domain>.json (keys
// flat `"records.notFound": "Fiche {id} introuvable"`).
import { useLocale } from "next-intl";
import {
  renderTemplate,
  toErrorItem,
  type ErrorItem,
} from "@getrunbase/core/app-error";
import type { Locale } from "@/i18n/config";
import automation from "@/messages/fr/errors/automation.json";
import data from "@/messages/fr/errors/data.json";
import interfaces from "@/messages/fr/errors/interfaces.json";
import platform from "@/messages/fr/errors/platform.json";
import web from "@/messages/fr/errors/web.json";

// One file per domain (avoids conflicts between parallel work).
export const FR_ERRORS: Record<string, string> = {
  ...data,
  ...automation,
  ...interfaces,
  ...platform,
  ...web,
};
const BY_LOCALE: Partial<Record<Locale, Record<string, string>>> = {
  fr: FR_ERRORS,
};

const isItem = (e: unknown): e is ErrorItem =>
  typeof e === "object" &&
  e !== null &&
  typeof (e as ErrorItem).code === "string" &&
  typeof (e as ErrorItem).message === "string" &&
  !(e instanceof Error);

// Error (AppError, Error), serialized item ({code, params, message}) or
// text -> displayable text. Code unknown in the locale: English message.
export function errorText(e: unknown, locale: Locale): string {
  if (typeof e === "string") return e;
  const item = isItem(e) ? e : toErrorItem(e);
  const template = BY_LOCALE[locale]?.[item.code];
  if (!template) return item.message;
  // `{details}`: list of items, translated as well (e.g. templates.invalid).
  const params = item.items?.length
    ? {
        ...item.params,
        details: item.items.map((i) => errorText(i, locale)).join("\n"),
      }
    : item.params;
  return renderTemplate(template, params ?? {});
}

// Client: const errorText = useErrorText(); errorText(state.error)
export function useErrorText() {
  const locale = useLocale();
  return (e: unknown) => errorText(e, locale);
}
