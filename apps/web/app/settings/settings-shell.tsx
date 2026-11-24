// Shared settings template (boards DNCwy, PryyU, KhoiA, qglrI, gJ11a):
// "Settings" header + tabs, then sections with a top border.
import { billingService } from "@getrunbase/core/quotas";
import type { LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "cn";
import { Count } from "@/components/ds/atoms";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings-tabs";

export async function SettingsPage({
  isAdmin,
  actions,
  children,
}: {
  isAdmin: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = await getTranslations("settings.page");
  return (
    <main className="flex flex-1 flex-col gap-6 px-12 py-8">
      <PageHeader title={t("title")} description={t("description")}>
        {actions}
      </PageHeader>
      <SettingsTabs isAdmin={isAdmin} billing={billingService.enabled()} />
      {children}
    </main>
  );
}

// Two-column section (DNCwy): 280px intro, fields on the right, gap 48, p 24/0.
export function SettingsSection({
  title,
  description,
  danger,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border flex flex-col gap-12 border-t py-6 lg:flex-row">
      <div className="flex w-full shrink-0 flex-col gap-1 lg:w-70">
        <h2
          className={cn(
            "text-base font-semibold",
            danger ? "text-destructive" : "text-foreground",
          )}
        >
          {title}
        </h2>
        {description && (
          <p className="text-muted-foreground text-sm leading-5">{description}</p>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
    </section>
  );
}

// Section header above a table (KhoiA, qglrI, gJ11a): p-t 24, top border.
export function SectionHead({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-border flex flex-wrap items-end gap-4 border-t pt-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-foreground text-base font-semibold">{title}</h2>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

// Table title with counter (PryyU): 14/600, p-b 12, gap 8.
export function TableHeading({
  title,
  count,
}: {
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 pb-3">
      <h2 className="text-foreground text-base font-semibold">{title}</h2>
      <Count>{count}</Count>
    </div>
  );
}

// Footer note (KhoiA, qglrI): secondary background, p 12/16, radius 6.
export function SettingsNote({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-secondary text-muted-foreground flex items-center gap-2 rounded-md px-4 py-3 text-sm">
      <Icon className="size-3.5 shrink-0" />
      <p className="flex-1">{children}</p>
    </div>
  );
}
