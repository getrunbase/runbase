import { secretsService } from "@getrunbase/core/secrets";
import { secretUsageService } from "@getrunbase/core/secrets/usage";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@getrunbase/ui/components/ui/table";
import { ConfirmAction } from "@/components/confirm-action";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { isOrgAdmin } from "@/lib/settings-access";
import { removeSecret } from "./actions";
import { NewSecret } from "./new-secret";
import { SectionHead, SettingsNote, SettingsPage } from "../settings-shell";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("secrets");

// Workspace secrets (qglrI board): names only.
export default async function Secrets() {
  const { ctx, role } = await getTenant();
  if (!isOrgAdmin(role)) notFound();
  const isAdmin = isOrgAdmin(role);
  const [list, usage] = await Promise.all([
    secretsService.list(ctx),
    secretUsageService.all(ctx),
  ]);
  const t = await getTranslations("settings.secrets");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  // "Workflow Sync, Function enrich": where the secret is referenced.
  const usedBy = (name: string) =>
    format.list(
      (usage[name] ?? []).map((u) => t(`usage.${u.type}`, { name: u.name })),
    );
  return (
    <SettingsPage isAdmin={isAdmin}>
      <div className="flex flex-col">
        <SectionHead title={t("title")} description={t("description")}>
          {isAdmin && <NewSecret />}
        </SectionHead>
        {list.length === 0 ? (
          <EmptyState
            icon={Lock}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            className="mt-6"
          />
        ) : (
          <Table className="mt-6">
            <TableHeader>
              <TableRow className="h-7.5">
                <TableHead>{tc("name")}</TableHead>
                <TableHead className="w-55">{t("value")}</TableHead>
                <TableHead className="w-37.5">{t("modified")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s) => (
                <TableRow key={s.name}>
                  <TableCell>
                    <div className="text-foreground font-mono font-medium">
                      {s.name}
                    </div>
                    {usage[s.name] && (
                      <div className="text-muted-foreground text-xs">
                        {t("usedBy", { list: usedBy(s.name) })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono">
                    {"••••••••••••••••"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.relativeTime(s.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <ConfirmAction
                        action={removeSecret}
                        fields={{ name: s.name }}
                        variant="ghost"
                        label={tc("delete")}
                        title={t("deleteTitle", { name: s.name })}
                        description={
                          usage[s.name]
                            ? t("deleteUsed", { list: usedBy(s.name) })
                            : t("deleteDescription")
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {!isAdmin && <SettingsNote icon={Lock}>{tc("adminOnly")}</SettingsNote>}
      <SettingsNote icon={Lock}>
        {t.rich("note", {
          code: (c) => <code className="font-mono">{c}</code>,
        })}
      </SettingsNote>
    </SettingsPage>
  );
}
