"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  AppWindow,
  Boxes,
  Activity,
  ScrollText,
  Users,
  Webhook,
  LayoutGrid,
  ChevronRight,
  CircleCheckBig,
  Database,
  FileText,
  History,
  House,
  KeyRound,
  Lock,
  OctagonAlert,
  Plus,
  Settings,
  SquareFunction,
  Table2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { PageIcon } from "@/components/page-icon";
import { IconTile } from "@/components/ds/atoms";
import type { Tone } from "@/components/ds/tone";

// Icons by key: components do not cross the server/client boundary.
const ICONS = {
  home: House,
  objects: Boxes,
  databases: Database,
  pages: AppWindow,
  workflows: Workflow,
  functions: SquareFunction,
  queries: Database,
  runs: History,
  approvals: CircleCheckBig,
  errors: OctagonAlert,
  secrets: Lock,
  apiKeys: KeyRound,
  settings: Settings,
  page: FileText,
  interfaces: LayoutGrid,
  webhooks: Webhook,
  events: Activity,
  audit: ScrollText,
  members: Users,
} satisfies Record<string, LucideIcon>;

// Tile colour by key (N4zA5 board).
const TONES: Partial<Record<keyof typeof ICONS, Tone>> = {
  home: "yellow",
  pages: "purple",
  interfaces: "purple",
  page: "purple",
  objects: "blue",
  databases: "blue",
  queries: "blue",
  events: "blue",
  workflows: "orange",
  runs: "orange",
  approvals: "orange",
  functions: "orange",
  webhooks: "orange",
  errors: "red",
};

export type NavEntry = {
  title: string;
  url: string;
  icon: keyof typeof ICONS;
  // Free lucide icon (kebab-case): takes precedence over `icon` (interfaces).
  lucide?: string;
  badge?: number;
  items?: { title: string; url: string }[];
};

const isActive = (path: string, url: string) =>
  url === "/" ? path === "/" : path === url || path.startsWith(url + "/");

// Sidebar navigation (sidebar-07 block): entries with a collapsible sub-list.
export function NavMain({
  label,
  items,
  action,
  className,
  collapsible,
}: {
  collapsible?: boolean;
  label?: string;
  items: NavEntry[];
  action?: { href: string; label: string } | React.ReactNode;
  className?: string;
}) {
  const path = usePathname();
  const { state } = useSidebar();
  const [open, setOpen] = useState(() =>
    items.some((i) => isActive(path, i.url)),
  );
  const menu = <Menu items={items} path={path} />;
  if (collapsible)
    return (
      // Sidebar collapsed to icons: the group stays open, otherwise its entries are unreachable.
      <Collapsible
        open={open || state === "collapsed"}
        onOpenChange={setOpen}
        className="group/collapsible"
        asChild
      >
        <SidebarGroup className={className}>
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger>
              {label}
              <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent>{menu}</CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    );
  return (
    <SidebarGroup className={className}>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      {action && !(typeof action === "object" && "href" in action) && action}
      {action && typeof action === "object" && "href" in action && (
        <SidebarGroupAction asChild title={action.label}>
          <Link href={action.href}>
            <Plus />
            <span className="sr-only">{action.label}</span>
          </Link>
        </SidebarGroupAction>
      )}
      {menu}
    </SidebarGroup>
  );
}

function Menu({ items, path }: { items: NavEntry[]; path: string }) {
  return (
    <SidebarMenu>
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const tone = TONES[item.icon] ?? "neutral";
        const active = isActive(path, item.url);
        return (
          <SidebarMenuItem key={item.url}>
            <SidebarMenuButton asChild tooltip={item.title} isActive={active}>
              <Link href={item.url}>
                <IconTile
                  tone={tone}
                  icon={item.lucide ? <PageIcon name={item.lucide} /> : Icon}
                />
                <span>{item.title}</span>
              </Link>
            </SidebarMenuButton>
            {!!item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
            {item.items?.map((sub) => (
              <SidebarMenuButton
                key={sub.url}
                asChild
                tooltip={sub.title}
                isActive={path === sub.url}
                className="mt-px pl-7"
              >
                <Link href={sub.url}>
                  <IconTile tone={tone} icon={Table2} />
                  <span>{sub.title}</span>
                </Link>
              </SidebarMenuButton>
            ))}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
