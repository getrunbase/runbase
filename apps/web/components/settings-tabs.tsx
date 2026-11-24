"use client";
// Settings tabs: a single link in the sidebar, the rest here.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger } from "@getrunbase/ui/components/ui/tabs";

const TABS = [
  { href: "/settings/general", label: "general" },
  { href: "/settings/members", label: "members" },
  { href: "/settings/api-keys", label: "apiKeys", admin: true },
  { href: "/settings/secrets", label: "secrets", admin: true },
  { href: "/settings/audit", label: "audit" },
  // Only if the billing extension provides a plan.
  { href: "/settings/billing", label: "billing", billing: true },
] as const;

export function SettingsTabs({
  isAdmin,
  billing = false,
}: {
  isAdmin: boolean;
  billing?: boolean;
}) {
  const t = useTranslations("nav.settingsTabs");
  const pathname = usePathname();
  const tabs = TABS.filter(
    (tab) => (isAdmin || !("admin" in tab)) && (billing || !("billing" in tab)),
  );
  return (
    <Tabs value={pathname} className="overflow-x-auto">
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.href} value={tab.href} asChild>
            <Link href={tab.href}>{t(tab.label)}</Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
