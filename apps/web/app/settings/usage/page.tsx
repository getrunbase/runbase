import { usageService } from "@getrunbase/core/quotas";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getTenant } from "@/lib/tenant";
import { SettingsPage, SettingsSection } from "../settings-shell";
import { pageTitle } from "@/lib/page-title";
import { formatMeter, meterPercent } from "@/lib/usage-format";

export const generateMetadata = pageTitle("usage");

// Settings › Usage: always shown, with or without a billing extension.
// A limit of null means unlimited (self-host default).
export default async function Usage() {
  const { ctx, role } = await getTenant();
  const meters = await usageService.get(ctx);
  const t = await getTranslations("settings.usage");
  const locale = await getLocale();
  const n = (key: string, v: number) => formatMeter(key, v, locale);
  return (
    <SettingsPage isAdmin={role === "owner" || role === "admin"}>
      <SettingsSection title={t("title")} description={t("description")}>
        {meters.map((it) => {
          const reached = it.limit != null && it.used >= it.limit;
          return (
            <div
              key={it.key}
              className="flex flex-col gap-2"
              data-usage={it.key}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="flex flex-1 flex-col">
                  <span className="text-foreground font-medium">
                    {t(`meters.${it.key}`)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t(`scope.${it.scope}`)}
                  </span>
                </span>
                {reached && <Badge variant="destructive">{t("reached")}</Badge>}
                <span className="text-muted-foreground tabular-nums">
                  {it.limit == null
                    ? t("unlimited", { used: n(it.key, it.used) })
                    : t("of", {
                        used: n(it.key, it.used),
                        limit: n(it.key, it.limit),
                      })}
                </span>
              </div>
              <Progress value={meterPercent(it.used, it.limit)} />
            </div>
          );
        })}
      </SettingsSection>
    </SettingsPage>
  );
}
