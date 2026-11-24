import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Messages } from "next-intl";

export type PageTitleKey = keyof Messages["common"]["titles"];

// Translated <title> for a route: `export const generateMetadata = pageTitle("runs")`.
// The root layout wraps it with its title template ("%s · Runbase").
export const pageTitle = (key: PageTitleKey) => async (): Promise<Metadata> => {
  const t = await getTranslations("common.titles");
  return { title: t(key) };
};
