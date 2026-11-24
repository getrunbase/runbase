// Page not found (broken link, deleted page or one reserved to another role).
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SearchXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@getrunbase/ui/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("home.notFound");
  const tc = await getTranslations("common");
  return (
    <main className="flex flex-1 flex-col p-4 md:p-6">
      <EmptyState
        icon={SearchXIcon}
        title={t("title")}
        description={t("description")}
      >
        <Button asChild>
          <Link href="/">{tc("backHome")}</Link>
        </Button>
      </EmptyState>
    </main>
  );
}
