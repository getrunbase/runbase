"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { switchWorkspaceTo } from "@/app/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type Workspace = { id: string; name: string };

// Workspace selector (team switcher from the sidebar-07 block).
export function TeamSwitcher({
  workspaces,
  currentId,
}: {
  workspaces: Workspace[];
  currentId: string;
}) {
  const t = useTranslations("nav");
  const { isMobile } = useSidebar();
  const router = useRouter();
  const [, start] = useTransition();
  const current = workspaces.find((w) => w.id === currentId);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={t("workspace.label")}
              className="h-auto px-2 py-1.5 data-[state=open]:bg-sidebar-accent"
            >
              <div className="bg-foreground text-background flex size-5.5 shrink-0 items-center justify-center rounded-sm text-tiny font-bold">
                {current?.name.slice(0, 1).toUpperCase()}
              </div>
              <span className="text-foreground flex-1 truncate text-sm font-semibold">
                {current?.name}
              </span>
              <ChevronsUpDown className="text-muted-foreground ml-auto size-3.5" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              {t("workspace.list")}
            </DropdownMenuLabel>
            {workspaces.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onSelect={() =>
                  start(async () => {
                    await switchWorkspaceTo(w.id);
                    router.refresh();
                  })
                }
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border text-xs">
                  {w.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="truncate">{w.name}</span>
                {w.id === currentId && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="gap-2 p-2">
              <Link href="/settings/general">
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <Plus className="size-4" />
                </div>
                <div className="text-muted-foreground font-medium">
                  {t("workspace.manage")}
                </div>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
