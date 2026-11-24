import { redirect } from "next/navigation";
import { getSession } from "@/lib/tenant";
import { MailOpen } from "lucide-react";
import { pendingInvitations } from "@getrunbase/core/members";
import { AuthFooter, AuthHeading, AuthShell } from "@/components/auth-shell";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import { getTranslations } from "next-intl/server";
import { ROLE_HINTS } from "@/lib/roles";
import { answerInvite } from "../actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("invitations");

// Pending invitations of the signed-in user (w0pyPu board): accept or decline.
export default async function Invitations() {
  const session = await getSession();
  if (!session) redirect("/login");
  const list = await pendingInvitations(session.user.id);
  const t = await getTranslations("auth.invitations");
  const ts = await getTranslations("settings");
  return (
    <AuthShell
      width="md"
      footer={
        <AuthFooter
          question={t("switchQuestion")}
          label={t("switchAccount")}
          href="/login"
        />
      }
    >
      {list.length === 0 ? (
        <EmptyState
          icon={MailOpen}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        list.map((i, n) => (
          <div
            key={i.organizationId}
            className={
              n > 0
                ? "flex flex-col gap-6 border-t border-border pt-6"
                : "flex flex-col gap-6"
            }
          >
            <div className="flex w-full flex-col items-center gap-4">
              <span className="flex size-10 items-center justify-center rounded-lg bg-foreground text-lg font-bold text-background">
                {i.organization.charAt(0).toUpperCase()}
              </span>
              <AuthHeading
                center
                title={t("heading", { organization: i.organization })}
                description={t("description")}
              />
            </div>
            <div className="flex w-full flex-col rounded-md ring-1 ring-border ring-inset">
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-muted-foreground">{t("roleLabel")}</span>
                <Badge variant="green">{ts(`roles.${i.role}`)}</Badge>
              </div>
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
                <span className="text-muted-foreground">{t("invitedAs")}</span>
                <span className="font-medium text-foreground">
                  {session.user.email}
                </span>
              </div>
            </div>
            {i.role in ROLE_HINTS && (
              <p className="text-xs text-muted-foreground">
                {ts(`roleHints.${i.role as keyof typeof ROLE_HINTS}`)}
              </p>
            )}
            <div className="flex w-full gap-3">
              <form action={answerInvite} className="flex flex-1">
                <input
                  type="hidden"
                  name="organizationId"
                  value={i.organizationId}
                />
                <Button type="submit" variant="outline" className="flex-1 p-3">
                  {t("decline")}
                </Button>
              </form>
              <form action={answerInvite} className="flex flex-1">
                <input
                  type="hidden"
                  name="organizationId"
                  value={i.organizationId}
                />
                <input type="hidden" name="accept" value="1" />
                <Button type="submit" className="flex-1 p-3">
                  {t("accept")}
                </Button>
              </form>
            </div>
          </div>
        ))
      )}
    </AuthShell>
  );
}
