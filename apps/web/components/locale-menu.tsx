"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { locales } from "@/i18n/config";
import { setLocale } from "@/i18n/actions";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

// Language choice, in the user menu (NEXT_LOCALE cookie).
export function LocaleMenu() {
  const t = useTranslations("common");
  const locale = useLocale();
  const [, start] = useTransition();
  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
        {t("language")}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={locale}
        onValueChange={(l) => start(() => setLocale(l))}
      >
        {locales.map((l) => (
          <DropdownMenuRadioItem
            key={l}
            value={l}
            onSelect={(e) => e.preventDefault()}
          >
            <Languages />
            {t(`languages.${l}`)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}
