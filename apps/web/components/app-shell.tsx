"use client";

import { usePathname } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { NavName } from "@/lib/breadcrumbs";

// Sidebar + topbar, except on the MCP OAuth flow screens (full page).
export function AppShell({
  sidebar,
  names,
  children,
}: {
  sidebar: React.ReactNode;
  names: Record<string, NavName>;
  children: React.ReactNode;
}) {
  if (usePathname().startsWith("/oauth")) return children;
  return (
    <SidebarProvider
      style={{ "--header-h": "var(--spacing-topbar)" } as React.CSSProperties}
    >
      {sidebar}
      {/* min-w-0: wide content (table) scrolls on its own, not the page. */}
      <SidebarInset className="min-w-0">
        <Topbar names={names} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
