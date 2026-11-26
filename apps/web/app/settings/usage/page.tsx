import { usageService } from "@getrunbase/core/quotas";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { canSeeUsage, isOrgAdmin } from "@/lib/settings-access";
import { SettingsPage, SettingsSection } from "../settings-shell";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("usage");

// Settings › Usage: always shown, with or without a billing extension.
// A limit of null means unlimited (self-host default).
export default async function Usage() {
  const { ctx, role } = await getTenant();
  // Viewers have no usage page (the service refuses them too).
  if (!canSeeUsage(role)) notFound();
  const meters = await usageService.get(ctx);
  const t = await getTranslations("settings.usage");
  const format = await getFormatter();
  const n = (key: string, v: number) =>
    key === "storageBytes"
      ? format.number(v / 1e9, { maximumFractionDigits: 2 }) + " GB"
      : format.number(v);
  return (
    <SettingsPage isAdmin={isOrgAdmin(role)}>
      <SettingsSection title={t("title")} description={t("description")}>
        {meters.map((it) => {
          const reached = it.limit != null && it.used >= it.limit;
          return (
            <div key={it.key} className="flex flex-col gap-2" data-usage={it.key}>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-foreground flex-1 font-medium">
                  {t(`meters.${it.key}`)}
                </span>
                {reached && <Badge variant="destructive">{t("reached")}</Badge>}
                <span className="text-muted-foreground tabular-nums">
                  {it.limit == null
                    ? t("unlimited", { used: n(it.key, it.used) })
                    : t("of", { used: n(it.key, it.used), limit: n(it.key, it.limit) })}
                </span>
              </div>
              <Progress
                value={
                  it.limit == null
                    ? 0
                    : it.limit > 0
                      ? Math.min(100, (it.used / it.limit) * 100)
                      : 100
                }
              />
            </div>
          );
        })}
      </SettingsSection>
    </SettingsPage>
  );
}
