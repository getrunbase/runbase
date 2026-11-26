import { apiKeysService } from "@getrunbase/core/api-keys";
import { objectsService } from "@getrunbase/core/objects";
import { workspacesService } from "@getrunbase/core/workspaces";
import { KeyRound, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@getrunbase/ui/components/ui/badge";
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
import { isAdminRole } from "@/lib/roles";
import { getTenant } from "@/lib/tenant";
import { revokeApiKey } from "./actions";
import { CreateKeyDialog } from "./create-form";
import { SectionHead, SettingsNote, SettingsPage } from "../settings-shell";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("apiKeys");

// Permission colour (KhoiA board).
const SCOPE_TONE = { read: "green", write: "orange", admin: "blue" } as const;

// Organization API keys (KhoiA board): creation, scopes, revocation.
export default async function ApiKeys() {
  const { ctx, role } = await getTenant();
  // Listing, creating and revoking keys: admins only (checked by the core).
  const isAdmin = isAdminRole(role);
  const tc = await getTranslations("common");
  if (!isAdmin)
    return (
      <SettingsPage isAdmin={false}>
        <SettingsNote icon={ShieldCheck}>{tc("adminOnly")}</SettingsNote>
      </SettingsPage>
    );
  const [keys, workspaces, objects] = await Promise.all([
    apiKeysService.list(ctx),
    workspacesService.list(ctx),
    objectsService.list(ctx),
  ]);
  const t = await getTranslations("settings.apiKeys");
  const format = await getFormatter();
  const date = (d: Date) =>
    format.dateTime(d, { dateStyle: "short", timeStyle: "short" });
  return (
    <SettingsPage isAdmin>
      <div className="flex flex-col">
        <SectionHead title={t("title")} description={t("description")}>
          <CreateKeyDialog
            workspaces={workspaces.map(({ id, name }) => ({ id, name }))}
            objects={objects.map(({ slug, name }) => ({ slug, name }))}
          />
        </SectionHead>
        {keys.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            className="mt-6"
          />
        ) : (
          <Table className="mt-6">
            <TableHeader>
              <TableRow className="h-7.5">
                <TableHead>{tc("name")}</TableHead>
                <TableHead className="w-50">{t("scopesLabel")}</TableHead>
                <TableHead className="w-37.5">{t("created")}</TableHead>
                <TableHead className="w-40">{t("lastUsed")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="text-foreground font-medium">
                    {k.name}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {k.revokedAt ? (
                        <Badge variant="red">{t("revoked")}</Badge>
                      ) : (
                        k.scopes.map((s) => (
                          <Badge
                            key={s}
                            variant={
                              SCOPE_TONE[s as keyof typeof SCOPE_TONE] ??
                              "neutral"
                            }
                          >
                            {t(`scopes.${s}`)}
                          </Badge>
                        ))
                      )}
                      {k.objects && (
                        <Badge variant="neutral">
                          {t("objectsBadge", { list: k.objects.join(", ") })}
                        </Badge>
                      )}
                      {k.tools && (
                        <Badge variant="neutral" title={k.tools.join(", ")}>
                          {t("toolsCount", { count: k.tools.length })}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {date(k.createdAt)}
                  </TableCell>
                  <TableCell
                    className={
                      k.lastUsedAt && !k.revokedAt
                        ? "text-muted-foreground"
                        : "text-subtle-foreground"
                    }
                  >
                    {k.lastUsedAt
                      ? format.relativeTime(k.lastUsedAt)
                      : t("never")}
                  </TableCell>
                  <TableCell className="text-right">
                    {k.revokedAt ? (
                      <span className="text-subtle-foreground px-3">{"—"}</span>
                    ) : (
                      <ConfirmAction
                        action={revokeApiKey}
                        fields={{ id: k.id }}
                        variant="ghost"
                        label={t("revoke")}
                        title={t("revokeTitle", { name: k.name })}
                        description={t("revokeDescription")}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <SettingsNote icon={ShieldCheck}>{t("note")}</SettingsNote>
    </SettingsPage>
  );
}
