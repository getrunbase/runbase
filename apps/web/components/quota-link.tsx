// Under a quota-reached message: link to Settings › Plan and usage for
// owners and admins ("link"), "ask an admin" text for the other roles
// ("ask"). Nothing without a billing extension (self-host).
import Link from "next/link";
import { useTranslations } from "next-intl";

export type QuotaHint = "link" | "ask";

export function QuotaLink({ show }: { show?: QuotaHint | false }) {
  const t = useTranslations("settings.billing.quota");
  if (!show) return null;
  if (show === "ask")
    return <p className="text-muted-foreground text-sm">{t("ask")}</p>;
  return (
    <Link
      href="/settings/billing"
      className="text-primary text-sm font-medium underline-offset-4 hover:underline"
    >
      {t("link")}
    </Link>
  );
}
