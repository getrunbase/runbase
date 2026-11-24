import type { NavEntry } from "@/components/nav-main";
import type { NavName } from "@/lib/breadcrumbs";
import type { T } from "@/lib/i18n-types";

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
// Interfaces, Data, Automations, and Settings at the bottom (tabs).
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
      for (const s of e.items ?? []) names[s.url] = { title: s.title };
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
    items: input.objects
      .filter((o) => o.databaseId === d.id)
      .map((o) => ({ title: o.name, url: `/objects/${o.slug}` })),
  }));
  const automations: NavEntry[] = [
    { title: t("items.workflows"), url: "/workflows", icon: "workflows" },
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
    { title: t("items.functions"), url: "/functions", icon: "functions" },
    { title: t("items.webhooks"), url: "/webhooks", icon: "webhooks" },
  ];
  const dataItems: NavEntry[] = [
    ...data,
    { title: t("items.events"), url: "/events", icon: "events" },
  ];
  const settings: NavEntry[] = [
    { title: t("items.settings"), url: "/settings", icon: "settings" },
  ];
  index(dataItems);
  index(automations);
  index(settings);
  return {
    sections: [
      { items: [{ title: t("sections.home"), url: "/", icon: "home" }] },
      { label: t("sections.interfaces"), items: interfaces },
      { label: t("sections.data"), items: dataItems },
      { label: t("sections.automations"), items: automations },
      { items: settings, bottom: true },
    ] as NavSection[],
    names,
    pagesOnly: false,
  };
}
