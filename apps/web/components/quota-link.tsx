// Link to Settings › Plan and usage under a quota-reached message.
// `show` false (self-host without extension): nothing.
import Link from "next/link";
import { useTranslations } from "next-intl";

export function QuotaLink({ show }: { show?: boolean }) {
  const t = useTranslations("settings.billing.quota");
  if (!show) return null;
  return (
    <Link
      href="/settings/billing"
      className="text-primary text-sm font-medium underline-offset-4 hover:underline"
    >
      {t("link")}
    </Link>
  );
}
