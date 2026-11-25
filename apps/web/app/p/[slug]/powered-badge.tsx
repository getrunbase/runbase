import { getTranslations } from "next-intl/server";

export async function PoweredBadge() {
  const t = await getTranslations("pages.badge");
  return (
    <a
      href="https://getrunbase.com"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("label")}
      className="fixed right-4 bottom-4 z-50 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {t("text")}
    </a>
  );
}
