"use client";
// Unexpected page error: clear message and a retry button.
import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { TriangleAlertIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@getrunbase/ui/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Logged in the browser console; on the server, onRequestError
  // (instrumentation.ts) already writes the "request failed" JSON line.
  useEffect(() => console.error(error), [error]);
  const t = useTranslations("home.error");
  const tc = useTranslations("common");
  return (
    <main className="flex flex-1 flex-col p-4 md:p-6">
      <EmptyState
        icon={TriangleAlertIcon}
        title={t("title")}
        description={t.rich("description", {
          digest: error.digest ?? t("unknown"),
          code: (c) => <code>{c}</code>,
        })}
      >
        <div className="flex gap-2">
          <Button onClick={reset}>{tc("retry")}</Button>
          <Button variant="outline" asChild>
            <Link href="/">{tc("backHome")}</Link>
          </Button>
        </div>
      </EmptyState>
    </main>
  );
}
