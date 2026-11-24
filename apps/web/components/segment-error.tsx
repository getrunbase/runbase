"use client";
// Local error of a segment (runs/[id], workflows/[id], objects/[slug]):
// rendered in the root layout, the sidebar and the header stay in place.
import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TriangleAlertIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@runbase/ui/components/ui/button";
import { useErrorText } from "@/lib/error-text";

export function SegmentError({
  title,
  error,
  reset,
}: {
  title: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const router = useRouter();
  // reset alone does not rerun the server render: we refresh too.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <main className="flex flex-1 flex-col p-4 md:p-6" data-segment-error>
      <EmptyState
        icon={TriangleAlertIcon}
        title={title}
        description={
          <>
            {errorText(error)}
            {error.digest && (
              <>
                {" "}
                <code>{error.digest}</code>
              </>
            )}
          </>
        }
      >
        <Button onClick={retry}>{tc("retry")}</Button>
      </EmptyState>
    </main>
  );
}
