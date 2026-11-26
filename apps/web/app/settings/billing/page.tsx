import { billingService } from "@getrunbase/core/quotas";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@getrunbase/ui/components/ui/button";
import { getTenant } from "@/lib/tenant";
import { SettingsPage, SettingsSection } from "../settings-shell";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("billing");

// Settings › Plan: current plan and links provided by the billing
// extension (usage lives in Settings › Usage). Without an extension (self-host): no page.
export default async function Billing() {
  const { ctx, role } = await getTenant();
  const billing = await billingService.get(ctx);
  if (!billing) notFound();
  const t = await getTranslations("settings.billing");
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
    </SettingsPage>
  );
}
