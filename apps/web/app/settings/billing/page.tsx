import { billingService } from "@getrunbase/core/quotas";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getTenant } from "@/lib/tenant";
import { SettingsPage, SettingsSection } from "../settings-shell";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("billing");

// Settings › Plan and usage: plan and links provided by
// the billing extension. Without an extension (self-host): no page.
export default async function Billing() {
  const { ctx, role } = await getTenant();
  const billing = await billingService.get(ctx);
  if (!billing) notFound();
  const t = await getTranslations("settings.billing");
  const format = await getFormatter();
  const n = (v: number) => format.number(v);
  return (
    <SettingsPage isAdmin={role === "owner" || role === "admin"}>
      <SettingsSection title={t("plan.title")} description={t("plan.description")}>
        <p className="text-foreground text-2xl font-semibold">{billing.plan}</p>
        <div className="flex flex-wrap gap-2">
          {billing.checkoutUrl && (
            <Button asChild>
              <a href={billing.checkoutUrl}>{t("plan.change")}</a>
            </Button>
          )}
          {billing.portalUrl && (
            <Button variant="outline" asChild>
              <a href={billing.portalUrl}>
                {t("plan.manage")}
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
        </div>
      </SettingsSection>
      <SettingsSection title={t("usage.title")} description={t("usage.description")}>
        {billing.items.map((it) => {
          const reached = it.limit != null && it.used >= it.limit;
          return (
            <div key={it.key} className="flex flex-col gap-2" data-usage={it.key}>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-foreground flex-1 font-medium">
                  {t(`usage.${it.key}`)}
                </span>
                {reached && <Badge variant="destructive">{t("usage.reached")}</Badge>}
                <span className="text-muted-foreground tabular-nums">
                  {it.limit == null
                    ? t("usage.unlimited", { used: n(it.used) })
                    : t("usage.of", { used: n(it.used), limit: n(it.limit) })}
                </span>
              </div>
              {it.limit != null && (
                <Progress
                  value={it.limit > 0 ? Math.min(100, (it.used / it.limit) * 100) : 100}
                />
              )}
            </div>
          );
        })}
      </SettingsSection>
    </SettingsPage>
  );
}
