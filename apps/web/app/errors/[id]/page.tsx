import { ActionForm } from "@/components/action-form";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { errorsService } from "@getrunbase/core/errors";
import { CheckCheck, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@getrunbase/ui/components/ui/tabs";
import { getTenant } from "@/lib/tenant";
import { resolveError, retryError } from "../actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("error");

const code =
  "bg-secondary overflow-auto rounded-md px-4 py-3 font-mono text-xs leading-node whitespace-pre-wrap";

// Error detail, HISSp board: header, meta, message and
// stack / payload tabs; "Replay" and "Resolve".
export default async function ErrorDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { ctx } = await getTenant();
  const t = await getTranslations("runs.errors");
  const format = await getFormatter();
  const e = await errorsService.get(ctx, (await params).id);
  if (!e) notFound();
  const ref = e.runId
    ? t("detail.runRef", { run: e.runId, step: e.stepId ?? "?" })
    : t("detail.ingestionRef", { request: e.request ?? "" });
  const open = e.status === "open";
  return (
    <main className="flex flex-1 flex-col gap-6 px-10 py-8">
      <PageHeader
        title={t("detail.title", {
          source: e.source,
          status: t(`status.${e.status}`),
        })}
        description={ref}
      >
        <div className="flex flex-wrap gap-2">
          <ActionForm action={resolveError}>
            <input type="hidden" name="id" value={e.id} />
            <Button type="submit" variant="outline" disabled={!open}>
              <CheckCheck />
              {t("detail.resolve")}
            </Button>
          </ActionForm>
          <ActionForm action={retryError}>
            <input type="hidden" name="id" value={e.id} />
            <Button type="submit">
              <RotateCcw />
              {t("detail.retry")}
            </Button>
          </ActionForm>
        </div>
      </PageHeader>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={open ? "red" : "green"}>
          {t(`status.${e.status}`)}
        </Badge>
        <Badge variant="orange">{e.source}</Badge>
        <span className="text-muted-foreground text-sm">
          {format.dateTime(e.createdAt, {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </span>
      </div>
      <section className="bg-background flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-base font-semibold">{t("detail.message")}</h2>
        <p className="text-sm leading-5">{e.message}</p>
        <Tabs defaultValue={e.stack ? "stack" : "payload"}>
          <TabsList>
            {e.stack && (
              <TabsTrigger value="stack">{t("detail.stack")}</TabsTrigger>
            )}
            <TabsTrigger value="payload">{t("detail.payload")}</TabsTrigger>
          </TabsList>
          {e.stack && (
            <TabsContent value="stack">
              <pre className={code}>{e.stack}</pre>
            </TabsContent>
          )}
          <TabsContent value="payload">
            <pre className={code}>{JSON.stringify(e.payload, null, 2)}</pre>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
