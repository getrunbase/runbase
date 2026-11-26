"use client";

import { useState } from "react";
import { Pencil, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ROLE_HINTS } from "@/lib/roles";
import { inviteMember, setMemberWorkspaces } from "../../actions";

type Workspace = { id: string; name: string };
// Owners and admins always access every workspace (core rule).
const allAccess = (role: string) => role === "owner" || role === "admin";

// "All workspaces" switch, then the workspace checkboxes when it is off.
// Posts `all` (switch) and `workspaceIds` (checked boxes).
function AccessFields({
  workspaces,
  role,
  all,
  setAll,
  ids,
  setIds,
}: {
  workspaces: Workspace[];
  role: string;
  all: boolean;
  setAll: (v: boolean) => void;
  ids: string[];
  setIds: (v: string[]) => void;
}) {
  const t = useTranslations("settings.members");
  if (allAccess(role))
    return (
      <p className="text-muted-foreground bg-muted rounded-md px-3 py-2 text-sm">
        {t("adminAllWorkspaces")}
      </p>
    );
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{t("workspacesLabel")}</legend>
      <Label className="justify-between font-normal">
        <span className="flex flex-col gap-0.5">
          <span className="text-foreground">{t("allWorkspaces")}</span>
          <span className="text-muted-foreground text-xs">
            {t("allWorkspacesHint")}
          </span>
        </span>
        <Switch name="all" value="1" checked={all} onCheckedChange={setAll} />
      </Label>
      {!all && (
        <div className="border-border flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border p-3">
          {workspaces.map((w) => (
            <Label key={w.id} className="font-normal">
              <Checkbox
                name="workspaceIds"
                value={w.id}
                checked={ids.includes(w.id)}
                onCheckedChange={(c) =>
                  setIds(
                    c ? [...ids, w.id] : ids.filter((x) => x !== w.id),
                  )
                }
              />
              {w.name}
            </Label>
          ))}
        </div>
      )}
      {!all && ids.length === 0 && (
        <p className="text-destructive text-sm">{t("noWorkspace")}</p>
      )}
    </fieldset>
  );
}

// Invitation dialog: email, role and workspaces (current one pre-checked).
export function InviteDialog({
  workspaces,
  currentWorkspaceId,
}: {
  workspaces: Workspace[];
  currentWorkspaceId: string;
}) {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("member");
  const [all, setAll] = useState(false);
  const [ids, setIds] = useState([currentWorkspaceId]);
  const reset = (o: boolean) => {
    setOpen(o);
    if (o) {
      setRole("member");
      setAll(false);
      setIds([currentWorkspaceId]);
    }
  };
  const valid = allAccess(role) || all || ids.length > 0;
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus />
          {t("members.invite")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("members.inviteTitle")}</DialogTitle>
          <DialogDescription>{t("members.inviteHint")}</DialogDescription>
        </DialogHeader>
        <form
          action={async (f) => {
            await inviteMember(f);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">{t("members.emailLabel")}</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              placeholder={t("members.emailPlaceholder")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">{t("roles.label")}</Label>
            <Select name="role" value={role} onValueChange={setRole}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_HINTS) as (keyof typeof ROLE_HINTS)[]).map(
                  (r) => (
                    <SelectItem key={r} value={r}>
                      {t(`roles.${r}`)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {t(`roleHints.${role as keyof typeof ROLE_HINTS}`)}
            </p>
          </div>
          <AccessFields
            workspaces={workspaces}
            role={role}
            all={all}
            setAll={setAll}
            ids={ids}
            setIds={setIds}
          />
          <DialogFooter>
            <Button type="submit" disabled={!valid}>
              {t("members.sendInvite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Workspace access of an existing member or invitee (owners/admins).
export function EditAccessDialog({
  member,
  workspaces,
}: {
  member: { id: string; name: string; role: string; workspaceIds: string[] | null };
  workspaces: Workspace[];
}) {
  const t = useTranslations("settings.members");
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(member.workspaceIds === null);
  const [ids, setIds] = useState(member.workspaceIds ?? []);
  const reset = (o: boolean) => {
    setOpen(o);
    if (o) {
      setAll(member.workspaceIds === null);
      setIds(member.workspaceIds ?? []);
    }
  };
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("editWorkspaces")}
          title={t("editWorkspaces")}
        >
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editWorkspacesTitle", { name: member.name })}</DialogTitle>
          <DialogDescription>{t("editWorkspacesHint")}</DialogDescription>
        </DialogHeader>
        <form
          action={async (f) => {
            await setMemberWorkspaces(f);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <input type="hidden" name="id" value={member.id} />
          <AccessFields
            workspaces={workspaces}
            role={member.role}
            all={all}
            setAll={setAll}
            ids={ids}
            setIds={setIds}
          />
          <DialogFooter>
            <Button type="submit" disabled={!all && ids.length === 0}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
