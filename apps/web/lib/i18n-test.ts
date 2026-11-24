// Tests: real translator for a namespace, with the repository messages.
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import type { T } from "./i18n-types";

export function translator<NS extends "common" | "nav" | "home">(
  locale: "en" | "fr",
  namespace: NS,
): T<NS> {
  const messages = JSON.parse(
    readFileSync(
      new URL(`../messages/${locale}/${namespace}.json`, import.meta.url),
      "utf8",
    ),
  );
  return createTranslator({
    locale,
    messages: { [namespace]: messages },
    namespace,
  }) as unknown as T<NS>;
}
