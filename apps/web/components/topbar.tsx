"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { PageIcon } from "@/components/page-icon";
import { TopbarBar } from "@/components/ds/topbar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { crumbs, type NavName } from "@/lib/breadcrumbs";
import { TOPBAR_ACTIONS_ID } from "@/components/topbar-actions";

// 44px topbar (N4zA5/JhKCs boards): sidebar toggle, breadcrumb section /
// collection / resource, page actions (TOPBAR_ACTIONS_ID portal).
export function Topbar({ names }: { names: Record<string, NavName> }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  // Resource outside the nav (run, record…): title of the displayed page.
  const [title, setTitle] = useState<string>();
  useEffect(() => {
    const read = () =>
      setTitle(
        document.querySelector("main main h1")?.textContent?.trim() ||
          undefined,
      );
    read();
    const obs = new MutationObserver(read);
    const main = document.querySelector("main");
    if (main) obs.observe(main, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [pathname]);
  const list = crumbs(pathname, names, title, t);
  return (
    <TopbarBar
      className="sticky top-0 z-10"
      toggle={
        <SidebarTrigger className="text-muted-foreground size-4 rounded-sm [&_svg]:size-4" />
      }
      crumbs={list.map((c) => ({
        label: c.label,
        href: c.href,
        icon: c.icon ? (
          <PageIcon name={c.icon} className="size-3.5" />
        ) : undefined,
      }))}
      actions={
        <div
          id={TOPBAR_ACTIONS_ID}
          className="flex shrink-0 items-center gap-2"
        />
      }
    />
  );
}
