import { getFormatter, getTranslations } from "next-intl/server";
import { eventsService } from "@getrunbase/core/events";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { getTenant } from "@/lib/tenant";
import { CopyPayload } from "./copy-payload";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("events");

type Q = { type?: string; record?: string; cursor?: string };

// Received events (webhooks, agents, API): the workspace timeline,
// A5yM2 board (expandable rows, payload on a secondary background).
export default async function Events({
  searchParams,
}: {
  searchParams: Promise<Q>;
}) {
  const { ctx } = await getTenant();
  const t = await getTranslations("runs.events");
  const format = await getFormatter();
  const q = await searchParams;
  const record = q.record?.trim() || undefined;
  const [{ items, nextCursor }, types] = await Promise.all([
    eventsService.list(ctx, {
      type: q.type,
      recordId: record,
      cursor: q.cursor,
    }),
    eventsService.types(ctx),
  ]);
  return (
    <main className="flex flex-1 flex-col gap-6 px-12 py-8">
      <PageHeader title={t("title")} description={t("description")} />
      <FilterBar
        filters={[
          {
            key: "type",
            label: t("filters.type"),
            options: types.map((v) => ({ value: v, label: v })),
          },
        ]}
        search={{ key: "record", placeholder: t("filters.record") }}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="flex flex-col">
          <div className="text-muted-foreground flex h-7.5 items-center border-y text-xs">
            <span className="w-7" />
            <span className="w-57.5 px-2">{t("table.type")}</span>
            <span className="min-w-0 flex-1 px-2">{t("table.record")}</span>
            <span className="w-37.5 px-2">{t("table.source")}</span>
            <span className="w-42.5 px-2">{t("table.date")}</span>
          </div>
          {items.map((e) => {
            const payload = JSON.stringify(e.payload);
            return (
              <details key={e.id} className="group border-b">
                <summary className="flex h-9 cursor-pointer list-none items-center text-sm">
                  <span className="text-muted-foreground flex w-7 justify-center">
                    <ChevronRight className="size-3.5 group-open:hidden" />
                    <ChevronDown className="hidden size-3.5 group-open:block" />
                  </span>
                  <span className="w-57.5 truncate px-2 font-mono">
                    {e.type}
                  </span>
                  <span className="min-w-0 flex-1 truncate px-2 font-mono text-xs">
                    {e.recordId ?? "—"}
                  </span>
                  <span className="text-muted-foreground w-37.5 truncate px-2">
                    {e.source ?? "—"}
                  </span>
                  <span className="text-muted-foreground w-42.5 px-2 font-mono">
                    {format.dateTime(e.occurredAt, {
                      dateStyle: "short",
                      timeStyle: "medium",
                    })}
                  </span>
                </summary>
                <div className="bg-secondary flex items-center gap-3 border-t py-2.5 pr-4 pl-11">
                  <span className="text-subtle-foreground text-xs">
                    {t("payload")}
                  </span>
                  <code className="min-w-0 flex-1 font-mono text-xs break-all">
                    {payload}
                  </code>
                  <CopyPayload value={payload} />
                </div>
              </details>
            );
          })}
        </div>
      )}
      <Pager params={q} nextCursor={nextCursor} />
    </main>
  );
}
