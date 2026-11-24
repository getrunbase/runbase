"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";

// "Copy" button for an event payload (A5yM2 board).
export function CopyPayload({ value }: { value: string }) {
  const t = useTranslations("common");
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      className="text-muted-foreground shrink-0"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />}
      {done ? t("copied") : t("copy")}
    </Button>
  );
}
