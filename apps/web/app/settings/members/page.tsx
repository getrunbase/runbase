import { membersService } from "@getrunbase/core/members";
import { ConfirmAction } from "@/components/confirm-action";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@getrunbase/ui/components/ui/table";
import type { Tone } from "@/components/ds/tone";
import { getFormatter, getTranslations } from "next-intl/server";
import { ROLE_HINTS } from "@/lib/roles";
import { getTenant } from "@/lib/tenant";
import { workspacesService } from "@getrunbase/core/workspaces";
import { removeMember, setMemberRole } from "../../actions";
import { EditAccessDialog, InviteDialog } from "./workspace-access";
import { SettingsPage, SettingsSection, TableHeading } from "../settings-shell";
import { pageTitle } from "@/lib/page-title";
import { ActionForm } from "@/components/action-form";

export const generateMetadata = pageTitle("members");

// Role colour (PryyU board).
const ROLE_TONE: Record<string, Exclude<Tone, "neutral">> = {
  owner: "purple",
  admin: "blue",
  member: "green",
  viewer: "yellow",
  end_user: "orange",
};

async function RoleSelect({ defaultValue }: { defaultValue: string }) {
  const t = await getTranslations("settings.roles");
  return (
    <Select name="role" defaultValue={defaultValue}>
      <SelectTrigger aria-label={t("label")} className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(ROLE_HINTS) as (keyof typeof ROLE_HINTS)[]).map((r) => (
          <SelectItem key={r} value={r}>
            {t(r)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const initials = (s: string) =>
  s
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

// Organization members (PryyU board): list, role, invitation, removal.
export default async function Members() {
  const { ctx, role } = await getTenant();
  const isAdmin = role === "owner" || role === "admin";
  const [all, workspaces] = await Promise.all([
    membersService.list(ctx),
    workspacesService.list(ctx),
  ]);
  const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
  const choices = workspaces.map(({ id, name }) => ({ id, name }));
  const t = await getTranslations("settings");
  const format = await getFormatter();
  const members = all.filter((m) => !m.pending);
  const pending = all.filter((m) => m.pending);

  const table = (rows: typeof all, invites: boolean) => (
    <Table>
      <TableHeader>
        <TableRow className="h-7.5">
          <TableHead>
            {invites ? t("members.colInvitee") : t("members.colMember")}
          </TableHead>
          <TableHead className="w-35">{t("roles.label")}</TableHead>
          <TableHead>{t("members.colWorkspaces")}</TableHead>
          <TableHead className="w-35">
            {invites ? t("members.colSent") : t("members.colAdded")}
          </TableHead>
          {isAdmin && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => (
          <TableRow key={m.id} className="h-12">
            <TableCell>
              <div className="flex items-center gap-3">
                <span className="bg-accent text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-tiny font-semibold">
                  {initials(m.name || m.email)}
                </span>
                <div className="flex min-w-0 flex-col gap-px">
                  <span className="text-foreground text-sm font-medium">
                    {m.name || m.email}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {m.email}
                  </span>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <Badge
                variant={ROLE_TONE[m.role] ?? "neutral"}
                className="font-mono"
                title={t(`roles.${m.role}`)}
              >
                {m.role}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1">
                {m.workspaceIds === null ? (
                  <Badge variant="neutral">{t("members.allWorkspaces")}</Badge>
                ) : (
                  m.workspaceIds.map((id) => (
                    <Badge key={id} variant="neutral">
                      {wsName.get(id) ?? id}
                    </Badge>
                  ))
                )}
                {isAdmin && m.role !== "owner" && m.role !== "admin" && (
                  <EditAccessDialog
                    member={{
                      id: m.id,
                      name: m.name || m.email,
                      role: m.role,
                      workspaceIds: m.workspaceIds,
                    }}
                    workspaces={choices}
                  />
                )}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {format.dateTime(m.createdAt, { dateStyle: "medium" })}
            </TableCell>
            {isAdmin && (
              <TableCell>
                {m.role !== "owner" && (
                  <div className="flex items-center justify-end gap-2">
                    <ActionForm action={setMemberRole} className="flex gap-2">
                      <input type="hidden" name="id" value={m.id} />
                      <RoleSelect defaultValue={m.role} />
                      <Button type="submit" variant="secondary">
                        {t("members.change")}
                      </Button>
                    </ActionForm>
                    <ConfirmAction
                      action={removeMember}
                      fields={{ id: m.id }}
                      variant="ghost"
                      label={
                        m.pending
                          ? t("members.cancelInvite")
                          : t("members.remove")
                      }
                      title={
                        m.pending
                          ? t("members.cancelInviteTitle", { email: m.email })
                          : t("members.removeTitle", {
                              name: m.name || m.email,
                            })
                      }
                      description={t("members.removeDescription")}
                      confirmLabel={
                        m.pending
                          ? t("members.cancelInvite")
                          : t("members.remove")
                      }
                    />
                  </div>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <SettingsPage
      isAdmin={isAdmin}
      actions={
        isAdmin && (
          <InviteDialog
            workspaces={choices}
            currentWorkspaceId={ctx.workspaceId}
          />
        )
      }
    >
      <div className="flex flex-col">
        <TableHeading title={t("members.title")} count={members.length} />
        {table(members, false)}
      </div>
      {pending.length > 0 && (
        <div className="flex flex-col">
          <TableHeading
            title={t("members.pendingTitle")}
            count={pending.length}
          />
          {table(pending, true)}
        </div>
      )}
      <SettingsSection
        title={t("members.rolesTitle")}
        description={t("members.rolesHint")}
      >
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {(Object.keys(ROLE_HINTS) as (keyof typeof ROLE_HINTS)[]).map((r) => (
            <div key={r} className="contents">
              <dt className="text-foreground font-medium">{t(`roles.${r}`)}</dt>
              <dd className="text-muted-foreground">{t(`roleHints.${r}`)}</dd>
            </div>
          ))}
        </dl>
      </SettingsSection>
    </SettingsPage>
  );
}
