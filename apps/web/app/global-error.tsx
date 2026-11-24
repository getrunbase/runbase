"use client";
// Whole-application error (layout included): minimal standalone page.
// Outside the layout, so no NextIntlClientProvider: we bundle the messages
// and pick the browser locale.
import "./globals.css";
import { useEffect } from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { negotiate } from "@/i18n/config";
import enHome from "@/messages/en/home.json";
import frHome from "@/messages/fr/home.json";
import enCommon from "@/messages/en/common.json";
import frCommon from "@/messages/fr/common.json";
import { Button } from "@runbase/ui/components/ui/button";

const MESSAGES = {
  en: { home: enHome, common: enCommon },
  fr: { home: frHome, common: frCommon },
};

function Content({ reset }: { reset: () => void }) {
  const t = useTranslations("home.globalError");
  const tc = useTranslations("common");
  return (
    <div className="max-w-md space-y-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground text-sm">{t("description")}</p>
      <Button onClick={reset}>{tc("retry")}</Button>
    </div>
  );
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Logged in the browser console; on the server, onRequestError
  // (instrumentation.ts) already writes the "request failed" JSON line.
  useEffect(() => console.error(error), [error]);
  const locale = negotiate(
    typeof navigator === "undefined" ? null : navigator.languages.join(","),
  );
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="bg-background text-foreground flex min-h-screen items-center justify-center p-4">
        <NextIntlClientProvider
          locale={locale}
          messages={MESSAGES[locale] as never}
        >
          <Content reset={reset} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
