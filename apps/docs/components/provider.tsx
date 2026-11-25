"use client";
// Fumadocs root provider with the docs language: UI translations, and a
// language switcher that keeps the page (/docs/x <-> /docs/fr/x).
import { RootProvider } from "fumadocs-ui/provider/next";
import type { I18nProviderProps } from "fumadocs-ui/contexts/i18n";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { switchLanguage } from "@/lib/locale-path.mjs";

export function Provider({
  i18n,
  children,
}: {
  i18n: Omit<I18nProviderProps, "children" | "onLocaleChange">;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <RootProvider
      search={{ options: { api: "/docs/api/search" } }}
      i18n={{
        ...i18n,
        onLocaleChange: (lang) => router.push(switchLanguage(pathname, lang)),
      }}
    >
      {children}
    </RootProvider>
  );
}
