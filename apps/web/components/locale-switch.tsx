"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { Button } from "@runbase/ui/components/ui/button";
import { locales } from "@/i18n/config";
import { setLocale } from "@/i18n/actions";

// Language choice on pages outside the app shell (sign-in, sign-up…), where
// the user menu is not available. Same NEXT_LOCALE cookie as LocaleMenu.
export function LocaleSwitch() {
  const t = useTranslations("common");
  const locale = useLocale();
  const [pending, start] = useTransition();
  return (
    <div
      role="group"
      aria-label={t("language")}
      className="flex items-center gap-1 text-muted-foreground"
    >
      <Languages className="size-4" aria-hidden />
      {locales.map((l) => (
        <Button
          key={l}
          type="button"
          size="sm"
          variant={l === locale ? "secondary" : "ghost"}
          aria-pressed={l === locale}
          disabled={pending}
          onClick={() => start(() => setLocale(l))}
        >
          {t(`languages.${l}`)}
        </Button>
      ))}
    </div>
  );
}
