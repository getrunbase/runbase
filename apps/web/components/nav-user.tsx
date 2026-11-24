"use client";


import { useTranslations } from "next-intl";
import { Ellipsis, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { LocaleMenu } from "@/components/locale-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

type User = { name: string; email: string; image?: string | null };

const initials = (u: User) =>
  (u.name || u.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");

function Identity({ user }: { user: User }) {
  return (
    <>
      <Avatar className="size-6 rounded-full">
        {user.image && <AvatarImage src={user.image} alt={user.name} />}
        <AvatarFallback className="bg-tag-purple-bg text-tag-purple-fg text-micro rounded-full font-semibold">
          {initials(user)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-foreground truncate text-xs font-medium">
          {user.name || user.email}
        </span>
        <span className="text-muted-foreground truncate text-tiny">
          {user.email}
        </span>
      </div>
    </>
  );
}

// User block at the bottom of the sidebar: identity and sign-out (Better Auth).
export function NavUser({ user }: { user: User }) {
  const t = useTranslations("nav");
  const { isMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-auto rounded-md border-t p-2 data-[state=open]:bg-sidebar-accent"
            >
              <Identity user={user} />
              <Ellipsis className="text-muted-foreground ml-auto size-3.5" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Identity user={user} />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <LocaleMenu />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                await authClient.signOut();
                // Full navigation: the root layout (sidebar) re-renders
                // without a session, router.push would keep it in the client cache.
                window.location.assign("/login");
              }}
            >
              <LogOut />
              {t("user.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
