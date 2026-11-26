import type { NavEntry } from "@/components/nav-main";
import type { NavName } from "@/lib/breadcrumbs";
import type { T } from "@/lib/i18n-types";
import { canSeeSettings } from "./settings-access";

type Role = "owner" | "admin" | "member" | "viewer" | "end_user" | null;

export type NavSection = {
  label?: string;
  items: NavEntry[];
  // Section pinned to the bottom of the sidebar (Settings).
  bottom?: boolean;
  action?: { href: string; label: string };
};

export type NavInput = {
  databases: { id: string; name: string; slug: string }[];
  objects: { databaseId: string | null; name: string; slug: string }[];
  pages: { id: string; name: string; icon?: string | null }[];
  openErrors: number;
  waitingApprovals: number;
};

// Intent-based navigation, in a few groups with everyday vocabulary:
// Interfaces, Activity, Automations, Data, and Settings at the bottom (tabs).
export function buildNav(input: NavInput, role: Role, t: T<"nav">) {
  const interfaces: NavEntry[] = [
    ...input.pages.map((p): NavEntry => ({
      title: p.name,
      url: `/p/${p.id}`,
      icon: "pages",
      lucide: p.icon ?? undefined,
    })),
  ];
  const names: Record<string, NavName> = {};
  const index = (items: NavEntry[]) => {
    for (const e of items) {
      names[e.url] = { title: e.title, icon: e.lucide };
    }
  };
  index(interfaces);

  if (role === "end_user") {
    const pages = interfaces.filter((i) => i.url.startsWith("/p/"));
    return {
      sections: [
        {
          items: [
            { title: t("items.myPages"), url: "/p", icon: "pages" } as NavEntry,
            ...pages,
          ],
        },
      ] as NavSection[],
      names,
      pagesOnly: true,
    };
  }

  const data: NavEntry[] = input.databases.map((d) => ({
    title: d.name,
    url: `/databases/${d.slug}`,
    icon: "databases",
  }));
  // Objects are not listed in the sidebar, but breadcrumbs still need their names.
  for (const o of input.objects) names[`/objects/${o.slug}`] = { title: o.name };
  // What you build.
  const automations: NavEntry[] = [
    { title: t("items.workflows"), url: "/workflows", icon: "workflows" },
    { title: t("items.functions"), url: "/functions", icon: "functions" },
    { title: t("items.webhooks"), url: "/webhooks", icon: "webhooks" },
  ];
  // What runs, and what needs attention.
  const activity: NavEntry[] = [
    { title: t("items.runs"), url: "/runs", icon: "runs" },
    {
      title: t("items.approvals"),
      url: "/approvals",
      icon: "approvals",
      badge: input.waitingApprovals,
    },
    {
      title: t("items.errors"),
      url: "/errors",
      icon: "errors",
      badge: input.openErrors,
    },
    { title: t("items.events"), url: "/events", icon: "events" },
  ];
  // Viewers have no settings tab to open (lib/settings-access.ts).
  const settings: NavEntry[] = canSeeSettings(role)
    ? [{ title: t("items.settings"), url: "/settings", icon: "settings" }]
    : [];
  index(data);
  index(activity);
  index(automations);
  index(settings);
  return {
    sections: [
      { items: [{ title: t("sections.home"), url: "/", icon: "home" }] },
      { label: t("sections.interfaces"), items: interfaces },
      { label: t("sections.activity"), items: activity },
      { label: t("sections.automations"), items: automations },
      { label: t("sections.data"), items: data },
      { items: settings, bottom: true },
    ] as NavSection[],
    names,
    pagesOnly: false,
  };
}
