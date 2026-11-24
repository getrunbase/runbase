import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/tenant";
import { MessageSquareWarning } from "lucide-react";
import {
  FEEDBACK_KINDS,
  feedbackService,
  isPlatformAdmin,
} from "@runbase/core/feedback";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { JsonView } from "@/components/json-view";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@runbase/ui/components/ui/badge";
import { Button } from "@runbase/ui/components/ui/button";
import { Card } from "@runbase/ui/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@runbase/ui/components/ui/table";
import { getFormatter, getTranslations } from "next-intl/server";
import { toggleFeedback } from "./actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("adminFeedback");

type Q = { kind?: string; status?: string };

// Feedback sent by agents (feedback.send), across all accounts.
// Reserved to platform admins (PLATFORM_ADMIN_EMAILS).
export default async function AdminFeedback({
  searchParams,
}: {
  searchParams: Promise<Q>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isPlatformAdmin(session.user.email)) notFound();
  const q = await searchParams;
  const kind = FEEDBACK_KINDS.find((k) => k === q.kind);
  const items = await feedbackService.list({
    kind,
    open: q.status === "done" ? false : q.status === "all" ? undefined : true,
  });
  const t = await getTranslations("settings.admin");
  const format = await getFormatter();
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <PageHeader title={t("title")} description={t("description")} />
      <FilterBar
        filters={[
          {
            key: "kind",
            label: t("type"),
            options: FEEDBACK_KINDS.map((value) => ({
              value,
              label: t(`kinds.${value}`),
            })),
          },
          {
            key: "status",
            label: t("statusFilter"),
            options: [
              { value: "done", label: t("done") },
              { value: "all", label: t("all") },
            ],
          },
        ]}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={MessageSquareWarning}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("type")}</TableHead>
                <TableHead className="w-1/2">{t("feedback")}</TableHead>
                <TableHead>{t("account")}</TableHead>
                <TableHead>{t("when")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(({ f, org }) => (
                <TableRow key={f.id} className="align-top">
                  <TableCell>
                    <Badge
                      variant={f.kind === "bug" ? "destructive" : "secondary"}
                    >
                      {t(`kinds.${f.kind}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="w-1/2 max-w-md space-y-1 whitespace-normal">
                    <div className="font-medium">
                      {f.title}
                      {f.tool && (
                        <Badge variant="outline" className="ml-2 font-mono">
                          {f.tool}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground whitespace-pre-wrap">
                      {f.details}
                    </p>
                    {f.context != null && (
                      <JsonView label={t("context")} value={f.context} />
                    )}
                  </TableCell>
                  <TableCell>
                    {org ?? "—"}
                    <div className="text-muted-foreground text-xs">
                      {f.actorApiKeyId ? t("apiKey") : "OAuth"}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {format.dateTime(f.createdAt, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell>
                    <form action={toggleFeedback}>
                      <input type="hidden" name="id" value={f.id} />
                      <input
                        type="hidden"
                        name="resolved"
                        value={f.resolvedAt ? "0" : "1"}
                      />
                      <Button size="sm" variant="outline">
                        {f.resolvedAt ? t("reopen") : t("markDone")}
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </main>
  );
}
