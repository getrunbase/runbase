"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { UiLabelsContext } from "@/components/ui-labels";

// Translated labels for components/ui inside Runbase's own UI. Never used in
// the customer page runtime, which keeps the English defaults.
export function UiLabelsProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const labels = useMemo(
    () => ({
      close: t("close"),
      loading: t("loading"),
      sidebarTitle: t("sidebar.title"),
      sidebarDescription: t("sidebar.description"),
      sidebarToggle: t("sidebar.toggle"),
    }),
    [t],
  );
  return (
    <UiLabelsContext.Provider value={labels}>
      {children}
    </UiLabelsContext.Provider>
  );
}
