import { connectionsService } from "@getrunbase/core/connections";
import { Lock, Plug } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ConfirmAction } from "@/components/confirm-action";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@getrunbase/ui/components/ui/table";
import { getTenant } from "@/lib/tenant";
import { isOrgAdmin } from "@/lib/settings-access";
import { pageTitle } from "@/lib/page-title";
import { removeConnection } from "./actions";
import { ConnectButton } from "./connect-button";
import { SectionHead, SettingsNote, SettingsPage } from "../settings-shell";

export const generateMetadata = pageTitle("connections");

// OAuth connections of the workspace: accounts the connectors act as.
export default async function Connections({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { ctx, role } = await getTenant();
  if (!isOrgAdmin(role)) notFound();
  const [list, providers, sp] = await Promise.all([
    connectionsService.list(ctx),
    connectionsService.providers(ctx),
    searchParams,
  ]);
  const t = await getTranslations("settings.connections");
  const format = await getFormatter();
  return (
    <SettingsPage isAdmin>
      <div className="flex flex-col">
        <SectionHead title={t("title")} description={t("description")} />
        {sp.connected && (
          <p role="status" className="text-foreground mt-4 text-sm">
            {t("connected", { name: sp.connected })}
          </p>
        )}
        {sp.error && (
          <p role="alert" className="text-destructive mt-4 text-sm">
            {t("failed", { detail: sp.error })}
          </p>
        )}
        {providers.length === 0 ? (
          <EmptyState
            icon={Plug}
            title={t("noProvidersTitle")}
            description={t("noProvidersDescription")}
            className="mt-6"
          />
        ) : (
          <Table className="mt-6">
            <TableHeader>
              <TableRow className="h-7.5">
                <TableHead>{t("service")}</TableHead>
                <TableHead>{t("accounts")}</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => {
                const accounts = list.filter((c) => c.provider === p.provider);
                return (
                  <TableRow key={p.provider}>
                    <TableCell className="align-top">
                      <div className="text-foreground font-medium">
                        {p.provider}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {format.list(p.nodes)}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      {accounts.length === 0 && (
                        <span className="text-muted-foreground">
                          {t("none")}
                        </span>
                      )}
                      {accounts.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-mono">{c.name}</span>
                            {c.account && (
                              <span className="text-muted-foreground">
                                {" "}
                                · {c.account}
                              </span>
                            )}
                            <span className="text-muted-foreground text-xs">
                              {" "}
                              · {format.relativeTime(c.createdAt)}
                            </span>
                          </div>
                          <ConfirmAction
                            action={removeConnection}
                            fields={{ id: c.id }}
                            variant="ghost"
                            size="sm"
                            label={t("disconnect")}
                            title={t("disconnectTitle", { name: c.name })}
                            description={t("disconnectDescription")}
                          />
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {p.configured ? (
                        <ConnectButton provider={p.provider} />
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {t("notConfigured")}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <SettingsNote icon={Lock}>{t("note")}</SettingsNote>
    </SettingsPage>
  );
}
