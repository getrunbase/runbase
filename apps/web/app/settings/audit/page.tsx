import { auditService } from "@runbase/core/audit";
import { membersService } from "@runbase/core/members";
import { ScrollText, Sparkles, User } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { JsonView } from "@/components/json-view";
import { Pager } from "@/components/pager";
import { Badge } from "@runbase/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@runbase/ui/components/ui/table";
import type { Tone } from "@/components/ds/tone";
import { auditLabel } from "@/lib/audit-labels";
import { getFormatter, getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant";
import { SectionHead, SettingsPage } from "../settings-shell";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("audit");

const TYPES = [
  "record",
  "object",
  "database",
  "workflow",
  "run",
  "function",
  "page",
  "webhook",
  "secret",
  "api_key",
  "member",
  "workspace",
] as const;

// "Where" badge colour (gJ11a board).
const TYPE_TONE: Partial<Record<string, Tone>> = {
  workflow: "purple",
  run: "purple",
  function: "purple",
  webhook: "purple",
  api_key: "blue",
  secret: "orange",
  member: "green",
  workspace: "yellow",
};

type Q = { type?: string; cursor?: string };

// Audit log (gJ11a board): who did what, when, with the change details.
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<Q>;
}) {
  const { ctx, role } = await getTenant();
  const q = await searchParams;
  const [{ items, nextCursor }, members] = await Promise.all([
    auditService.list(ctx, { resourceType: q.type, cursor: q.cursor }),
    membersService.list(ctx),
  ]);
  const t = await getTranslations("settings.audit");
  const th = await getTranslations("home");
  const format = await getFormatter();
  const who = (a: (typeof items)[number]) => {
    if (a.actorApiKeyId) return t("agent");
    const m = members.find((x) => x.userId === a.actorUserId);
    return m ? m.name || m.email : t("system");
  };
  const isType = (v: string): v is (typeof TYPES)[number] =>
    (TYPES as readonly string[]).includes(v);
  return (
    <SettingsPage isAdmin={role === "owner" || role === "admin"}>
      <SectionHead title={t("title")} description={t("description")} />
      <FilterBar
        filters={[
          {
            key: "type",
            label: t("filter"),
            options: TYPES.map((value) => ({
              value,
              label: t(`types.${value}`),
            })),
          },
        ]}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="h-7.5">
              <TableHead className="w-42.5">{t("when")}</TableHead>
              <TableHead className="w-50">{t("by")}</TableHead>
              <TableHead>{t("action")}</TableHead>
              <TableHead className="w-32.5">{t("where")}</TableHead>
              <TableHead className="w-47.5">{t("detail")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((a) => {
              const Icon = a.actorApiKeyId ? Sparkles : User;
              return (
                <TableRow key={a.id} className="align-top">
                  <TableCell className="text-muted-foreground font-mono whitespace-nowrap">
                    {format.dateTime(a.createdAt, {
                      dateStyle: "short",
                      timeStyle: "medium",
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          a.actorApiKeyId
                            ? "bg-tag-purple-bg flex size-5 shrink-0 items-center justify-center rounded-full"
                            : "bg-accent flex size-5 shrink-0 items-center justify-center rounded-full"
                        }
                      >
                        <Icon className="size-2.75" />
                      </span>
                      <span className="text-foreground text-sm font-medium">
                        {who(a)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-foreground">
                    {auditLabel(a.action, th)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={TYPE_TONE[a.resourceType] ?? "neutral"}>
                      {isType(a.resourceType)
                        ? t(`types.${a.resourceType}`)
                        : a.resourceType}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal">
                    {a.diff != null && (
                      <JsonView label={t("change")} value={a.diff} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Pager params={q} nextCursor={nextCursor} />
    </SettingsPage>
  );
}
