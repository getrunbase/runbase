// Breadcrumb aligned with the sidebar: section › collection › resource.
// Never a raw URL segment: the resource takes the label known by the nav
// (`names`, url -> title/icon), otherwise the title of the displayed page.
import type { T } from "@/lib/i18n-types";

export type NavName = { title: string; icon?: string };
export type Crumb = { label: string; href?: string; icon?: string };

type Key = Parameters<T<"nav">>[0];
const SECTIONS: Record<string, [section: Key | "", label?: Key]> = {
  // Open interfaces: no section, just icon + name.
  p: [""],
  interfaces: ["sections.interfaces", "crumbs.allInterfaces"],
  databases: ["sections.data", "crumbs.databases"],
  objects: ["sections.data"],
  workflows: ["sections.automations", "items.workflows"],
  runs: ["sections.automations", "items.runs"],
  approvals: ["sections.automations", "items.approvals"],
  errors: ["sections.automations", "items.errors"],
  functions: ["sections.automations", "items.functions"],
  webhooks: ["sections.automations", "items.webhooks"],
  events: ["sections.data", "items.events"],
  queries: ["sections.data", "crumbs.queries"],
  settings: ["sections.settings"],
};

// Settings tabs (/settings/<slug>): tab label, never the slug.
const SETTINGS_TABS: Record<string, Key> = {
  general: "settingsTabs.general",
  members: "settingsTabs.members",
  "api-keys": "settingsTabs.apiKeys",
  secrets: "settingsTabs.secrets",
  audit: "settingsTabs.audit",
};

export function crumbs(
  pathname: string,
  names: Record<string, NavName>,
  title: string | undefined,
  t: T<"nav">,
): Crumb[] {
  const [first, second] = pathname.split("/").filter(Boolean);
  if (!first) return [{ label: t("sections.home") }];
  const [section, label] = SECTIONS[first] ?? [];
  if (section === undefined) return [{ label: title ?? t("sections.home") }];
  const out: Crumb[] = section ? [{ label: t(section) }] : [];
  if (first === "settings") {
    const tab = second && SETTINGS_TABS[second];
    if (tab) out.push({ label: t(tab), href: `/settings/${second}` });
    return out;
  }
  if (label) out.push({ label: t(label), href: `/${first}` });
  if (second) {
    const known = names[`/${first}/${second}`];
    out.push({
      label: known?.title ?? title ?? t("crumbs.detail"),
      href: `/${first}/${second}`,
      icon: known?.icon,
    });
  }
  return out;
}
