import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { Role } from "@getrunbase/core/members";
import { loadNavData } from "@getrunbase/core/nav";
import type { TenantContext } from "@getrunbase/core/tenant";
import { getTranslations } from "next-intl/server";
import { buildNav } from "@/lib/nav";
import { isOrgAdmin } from "@/lib/settings-access";

type User = { name: string; email: string; image?: string | null };

// Navigation data: sidebar sections and breadcrumb labels.
// One transaction, one query; workspaces provided by the context.
export async function loadNav(
  ctx: TenantContext,
  role: Role | null,
  workspaces: { id: string; name: string }[],
) {
  const [data, t] = await Promise.all([
    loadNavData(ctx, role),
    getTranslations("nav"),
  ]);
  return {
    workspaces,
    canManageWorkspaces: isOrgAdmin(role),
    ...buildNav(data, role, t),
  };
}

export type Nav = Awaited<ReturnType<typeof loadNav>>;

// Sidebar (sidebar-07 block): workspace, navigation, user.
export function AppSidebar({
  ctx,
  user,
  nav,
}: {
  ctx: TenantContext;
  user: User;
  nav: Nav;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <TeamSwitcher
          workspaces={nav.workspaces.map(({ id, name }) => ({ id, name }))}
          currentId={ctx.workspaceId}
          canManage={nav.canManageWorkspaces}
        />
      </SidebarHeader>
      <SidebarContent>
        {nav.sections
          .filter((s) => s.items.length)
          .map((s, i) => (
            <NavMain
              key={s.label ?? i}
              label={s.label}
              items={s.items}
              action={s.action}
              className={s.bottom ? "mt-auto" : undefined}
            />
          ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
