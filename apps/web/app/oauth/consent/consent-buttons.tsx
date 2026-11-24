"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { authClient, followOAuth } from "@/lib/auth-client";

export function ConsentButtons() {
  const [error, setError] = useState<string>();
  const t = useTranslations("auth.oauth");
  const answer = async (accept: boolean) => {
    const { data, error } = await authClient.oauth2.consent({ accept });
    if (error || !followOAuth(data)) setError(error?.message ?? t("error"));
  };
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex w-full gap-3">
        <Button
          variant="outline"
          className="flex-1 p-3"
          onClick={() => answer(false)}
        >
          {t("deny")}
        </Button>
        <Button className="flex-1 p-3" onClick={() => answer(true)}>
          {t("allow")}
        </Button>
      </div>
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
    </div>
  );
}
