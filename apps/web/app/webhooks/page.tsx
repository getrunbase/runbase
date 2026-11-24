import { headers } from "next/headers";
import { getFormatter, getTranslations } from "next-intl/server";
import { secretsService } from "@getrunbase/core/secrets";
import { webhooksService } from "@getrunbase/core/webhooks";
import { Webhook } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { CopyField } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { JsonView } from "@/components/json-view";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@getrunbase/ui/components/ui/table";
import { getTenant } from "@/lib/tenant";
import { clearWebhookSample, deleteWebhook } from "./actions";
import { CreateWebhookDialog, TestWebhookForm } from "./forms";
import { env } from "@getrunbase/core/env";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("webhooks");

const FORMATS = ["stripe", "standard", "hmac"] as const;
const formatKey = (v: string) => FORMATS.find((f) => f === v);

// Incoming webhooks (gC3wR board): table, then per-webhook detail
// (URL to copy, last received payload, test, deletion).
export default async function Webhooks() {
  const { ctx, role } = await getTenant();
  const t = await getTranslations("webhooks");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const isAdmin = role === "owner" || role === "admin";
  const [hooks, secrets] = await Promise.all([
    webhooksService.list(ctx),
    isAdmin ? secretsService.list(ctx) : Promise.resolve([]),
  ]);
  const h = await headers();
  const origin =
    env().BETTER_AUTH_URL ||
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  return (
    <main className="flex flex-1 flex-col gap-6 px-10 py-8">
      <PageHeader title={t("title")} description={t("description")}>
        {isAdmin && (
          <CreateWebhookDialog secrets={secrets.map((s) => s.name)} />
        )}
      </PageHeader>
      {hooks.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-47.5">{t("columns.name")}</TableHead>
                <TableHead>{t("columns.url")}</TableHead>
                <TableHead className="w-25">{t("columns.direction")}</TableHead>
                <TableHead className="w-25">{t("columns.format")}</TableHead>
                <TableHead className="w-45">
                  {t("columns.lastDelivery")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {hooks.map((w) => {
                const k = formatKey((w.config as { format: string }).format);
                return (
                  <TableRow key={w.id}>
                    <TableCell className="text-sm font-medium">
                      <a href={`#${w.id}`}>{w.name}</a>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-0 truncate font-mono text-xs">
                      {`${origin}${w.path}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant="blue">{t("direction.incoming")}</Badge>
                    </TableCell>
                    <TableCell>
                      {k && (
                        <Badge variant="neutral">{t(`formats.${k}`)}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {w.sampleAt ? format.relativeTime(w.sampleAt) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {hooks.map((w) => (
            <section
              key={w.id}
              id={w.id}
              className="flex flex-col gap-2.5 rounded-lg border p-4"
            >
              <div className="flex items-center gap-2">
                <h2 className="flex-1 text-base font-semibold">{w.name}</h2>
                {isAdmin && (
                  <ConfirmAction
                    action={deleteWebhook}
                    fields={{ id: w.id }}
                    variant="ghost"
                    size="sm"
                    label={tc("delete")}
                    title={t("delete.title", { name: w.name })}
                    description={t("delete.description")}
                  />
                )}
              </div>
              <p className="text-muted-foreground text-sm">
                {t.rich("card.produces", {
                  event: w.eventType,
                  secret: w.secretName,
                  code: (c) => <code className="font-mono text-xs">{c}</code>,
                })}
              </p>
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">{t("card.url")}</p>
                <CopyField
                  value={`${origin}${w.path}`}
                  label={t("card.copyUrl")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">{t("card.testUrl")}</p>
                <CopyField
                  value={`${origin}${w.testPath}`}
                  label={t("card.copyTestUrl")}
                />
              </div>
              {w.sample ? (
                <div className="flex flex-col gap-2">
                  <JsonView
                    label={t("card.sample", {
                      date: w.sampleAt
                        ? format.dateTime(w.sampleAt, {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "",
                    })}
                    value={w.sample}
                  />
                  {isAdmin && (
                    <form action={clearWebhookSample}>
                      <input type="hidden" name="id" value={w.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        {t("card.clearSample")}
                      </Button>
                    </form>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t("card.noSample")}
                </p>
              )}
              {isAdmin && <TestWebhookForm id={w.id} />}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
