"use client";
// Version history (pages and workflows): list, live version,
// draft, and one-click restore of an older version.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { HistoryIcon } from "lucide-react";
import { Badge } from "@runbase/ui/components/ui/badge";
import { Button } from "@runbase/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export type VersionRow = { version: number; createdAt: Date | string };

export function VersionHistory({
  current,
  draft,
  load,
  restore,
}: {
  // Live version and possible draft.
  current: number;
  draft?: number | null;
  load: () => Promise<VersionRow[]>;
  restore: (version: number) => Promise<unknown>;
}) {
  const t = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = (o: boolean) => {
    if (!o) return;
    setError(null);
    load().then(
      (r) => setRows([...r].reverse()),
      () => setError(t("versions.loadError")),
    );
  };
  return (
    <Sheet onOpenChange={open}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <HistoryIcon />
          {t("versions.open")}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t("versions.title")}</SheetTitle>
          <SheetDescription>{t("versions.description")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
          {error && <p className="text-destructive text-sm">{error}</p>}
          {!rows && !error && (
            <p className="text-muted-foreground text-sm">{t("loading")}</p>
          )}
          {rows?.map((v) => (
            <div
              key={v.version}
              className="flex items-center justify-between gap-2 rounded-md border p-3"
            >
              <div className="grid gap-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {t("versions.version", { version: v.version })}
                  {v.version === current && <Badge>{t("versions.live")}</Badge>}
                  {v.version === draft && (
                    <Badge variant="secondary">{t("versions.draft")}</Badge>
                  )}
                </div>
                <span className="text-muted-foreground text-xs">
                  {format.dateTime(new Date(v.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              {v.version !== current && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      try {
                        await restore(v.version);
                        setRows(null);
                        open(true);
                        router.refresh();
                      } catch {
                        setError(t("versions.restoreError"));
                      }
                    })
                  }
                >
                  {t("restore")}
                </Button>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
