// Page loading: plain skeleton instead of a blank screen.
import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

export default async function Loading() {
  const t = await getTranslations("home");
  return (
    <main
      className="flex flex-1 flex-col gap-4 p-4 md:p-6"
      aria-busy
      aria-label={t("loading")}
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
    </main>
  );
}
