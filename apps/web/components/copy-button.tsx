"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@runbase/ui/components/ui/button";

// Read-only field + copy button (URL, key, command).
export function CopyField({ value, label }: { value: string; label?: string }) {
  const t = useTranslations("common");
  const [done, setDone] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1.5 text-xs">
        {value}
      </code>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={label ?? t("copy")}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check /> : <Copy />}
        {done ? t("copied") : t("copy")}
      </Button>
    </div>
  );
}
