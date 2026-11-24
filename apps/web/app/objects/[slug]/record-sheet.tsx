"use client";

import { useErrorText } from "@/lib/error-text";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { recordTitle, type Field } from "@runbase/core/objects/fields";
import { Badge } from "@runbase/ui/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@runbase/ui/components/ui/tabs";
import { Button } from "@runbase/ui/components/ui/button";
import { loadRecord, recordHistory, revertRecord, updateCell } from "./actions";
import { ExportMenu, ImportDialog } from "./data-tools";
import { RefSelect } from "./ref-select";
import { Cell, RecordsTable, RefLinks } from "./records-table";

type Loaded = NonNullable<Awaited<ReturnType<typeof loadRecord>>["data"]>;

// Table + record view: the open record is in the URL (`?record=`),
// which makes refs to other objects clickable with a plain link.
export function RecordsView(props: {
  slug: string;
  objectId: string;
  fields: Field[];
  workflows: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const recordId = useSearchParams().get("record");
  const [reload, setReload] = useState(0);
  const open = (id: string | null) =>
    router.replace(id ? `${pathname}?record=${id}` : pathname, {
      scroll: false,
    });
  return (
    <>
      <RecordsTable
        key={reload}
        {...props}
        onOpen={open}
        actions={
          <>
            <ImportDialog
              objectId={props.objectId}
              fields={props.fields}
              onDone={() => setReload((n) => n + 1)}
            />
            <ExportMenu slug={props.slug} />
          </>
        }
      />
      <Sheet
        open={!!recordId}
        onOpenChange={(o) => {
          if (o) return;
          open(null);
          setReload((n) => n + 1);
        }}
      >
        <SheetContent className="w-full gap-0 sm:max-w-5xl">
          {recordId && <RecordSheet id={recordId} fields={props.fields} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function RecordSheet({ id, fields }: { id: string; fields: Field[] }) {
  const t = useTranslations("objects.sheet");
  const tc = useTranslations("common");
  const [rec, setRec] = useState<Loaded>();
  const [error, setErrorRaw] = useState<string>();
  const errorText = useErrorText();
  // Action errors arrive as serializable items: translated here.
  const setError = (e?: unknown) => setErrorRaw(e ? errorText(e) : undefined);

  useEffect(() => {
    let live = true;
    setRec(undefined);
    loadRecord(id).then((res) => {
      if (!live) return;
      setError(res.error);
      setRec(res.data);
    });
    return () => {
      live = false;
    };
  }, [id]);

  async function save(key: string, value: unknown) {
    const res = await updateCell(id, key, value);
    if (res.error) return setError(res.error);
    // Reload: the change also shows up in the timeline.
    const fresh = await loadRecord(id);
    if (fresh.data) setRec(fresh.data);
  }

  const title = rec
    ? recordTitle(fields, { id, data: rec.data })
    : tc("loading");

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="text-2xl font-bold">{title}</SheetTitle>
        <SheetDescription>
          {rec
            ? t("summary", {
                events: rec.events.length,
                runs: rec.runs.length,
              })
            : " "}
        </SheetDescription>
      </SheetHeader>
      {error && <p className="p-4 text-sm text-destructive">{error}</p>}
      {rec && (
        <div className="grid min-h-0 flex-1 md:grid-cols-[2fr_3fr]">
          <dl className="flex flex-col gap-2.5 overflow-y-auto border-r p-4 text-sm">
            {fields.map((f) => (
              <div
                key={f.key}
                className="grid grid-cols-[auto_1fr] items-center gap-3 [&>dt]:w-27.5"
              >
                <dt className="truncate text-muted-foreground">{f.label}</dt>
                <dd className="min-h-8 min-w-0 content-center">
                  {f.type === "ref" || f.type === "refs" ? (
                    <RefSelect
                      object={f.object}
                      multiple={f.type === "refs"}
                      value={
                        f.type === "ref"
                          ? [rec.refs[f.key]].filter((l) => !!l)
                          : (rec.refsMany[f.key] ?? [])
                      }
                      onSave={(v) => save(f.key, v)}
                    />
                  ) : (
                    <Cell
                      inline
                      field={f}
                      value={rec.data[f.key]}
                      onSave={(v) => save(f.key, v)}
                    />
                  )}
                </dd>
              </div>
            ))}
            {rec.inverse.map((i) => (
              <div
                key={i.label}
                className="grid grid-cols-[auto_1fr] items-center gap-3 [&>dt]:w-27.5"
              >
                {/* Full label: "Object · relation" on several lines. */}
                <dt className="text-muted-foreground break-words">{i.label}</dt>
                <dd className="min-h-8 min-w-0 content-center">
                  <RefLinks object={i.object} links={i.records} />
                </dd>
              </div>
            ))}
          </dl>
          <Tabs defaultValue="timeline" className="min-h-0 overflow-y-auto p-4">
            <TabsList>
              <TabsTrigger value="timeline">{t("timeline")}</TabsTrigger>
              <TabsTrigger value="runs">{t("runs")}</TabsTrigger>
              <TabsTrigger value="history">{t("history")}</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline">
              <Timeline events={rec.events} />
            </TabsContent>
            <TabsContent value="runs">
              <Runs runs={rec.runs} />
            </TabsContent>
            <TabsContent value="history">
              <History
                id={id}
                fields={fields}
                onRevert={async () => {
                  const fresh = await loadRecord(id);
                  if (fresh.data) setRec(fresh.data);
                }}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </>
  );
}

// Date and time in the user's locale.
function useFmt() {
  const format = useFormatter();
  return (d: Date | string | null) =>
    d
      ? format.dateTime(new Date(d), { dateStyle: "short", timeStyle: "short" })
      : "";
}

// Timeline: most recent at the top.
function Timeline({ events }: { events: Loaded["events"] }) {
  const t = useTranslations("objects.sheet");
  const fmt = useFmt();
  if (!events.length)
    return (
      <p className="py-6 text-sm text-muted-foreground">{t("noEvents")}</p>
    );
  return (
    <ol className="relative ml-2 space-y-4 border-l py-2 pl-4">
      {[...events].reverse().map((e) => (
        <li key={e.id} className="text-sm">
          <span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-primary" />
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium">{e.type}</span>
            <span className="text-xs text-muted-foreground">
              {fmt(e.occurredAt)}
              {e.source && ` · ${e.source}`}
            </span>
          </div>
          {Object.keys(e.payload ?? {}).length > 0 && (
            <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(e.payload, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
}

// Translated audit actions: `objects.history.actions.<action>` key.
const ACTIONS = {
  "record.create": "create",
  "record.update": "update",
  "record.delete": "delete",
  "record.restore": "restore",
  "record.merge": "merge",
} as const;

type Entry = NonNullable<Awaited<ReturnType<typeof recordHistory>>["data"]>[0];

// History: each change with its before / after values, and
// "Restore" to go back to the previous values.
function History({
  id,
  fields,
  onRevert,
}: {
  id: string;
  fields: Field[];
  onRevert: () => Promise<void>;
}) {
  const t = useTranslations("objects.history");
  const tc = useTranslations("common");
  const fmt = useFmt();
  const show = (v: unknown) =>
    v == null || v === ""
      ? t("empty")
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  const [entries, setEntries] = useState<Entry[]>();
  const [error, setErrorRaw] = useState<string>();
  const errorText = useErrorText();
  // Action errors arrive as serializable items: translated here.
  const setError = (e?: unknown) => setErrorRaw(e ? errorText(e) : undefined);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    recordHistory(id).then((res) => {
      setError(res.error);
      setEntries(res.data);
    });
  }, [id, reload]);
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k;

  if (!entries)
    return (
      <p className="py-6 text-sm text-muted-foreground">{tc("loading")}</p>
    );
  return (
    <div className="space-y-3 py-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {entries.map((e) => (
        <div key={e.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {e.action in ACTIONS
                ? t(`actions.${ACTIONS[e.action as keyof typeof ACTIONS]}`)
                : e.action}
            </span>
            <span className="text-xs text-muted-foreground">
              {fmt(e.createdAt)}
              {e.byKey && ` · ${t("byKey")}`}
            </span>
            {e.action === "record.update" && e.diff?.before && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7"
                onClick={async () => {
                  const res = await revertRecord(id, e.id);
                  setError(res.error);
                  await onRevert();
                  setReload((n) => n + 1);
                }}
              >
                {t("revert")}
              </Button>
            )}
          </div>
          {e.action === "record.update" && e.diff?.before && (
            <ul className="mt-2 space-y-1">
              {(e.diff.changed ?? []).map((k) => (
                <li key={k} className="break-words">
                  <span className="text-muted-foreground">
                    {t("fieldLabel", { field: label(k) })}{" "}
                  </span>
                  <span className="line-through">
                    {show(e.diff!.before![k])}
                  </span>
                  {" → "}
                  <span>{show(e.diff!.after?.[k])}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

const STATUS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  succeeded: "default",
  failed: "destructive",
  running: "secondary",
};

// Runs: path taken (steps, branches) and reasons for AI decisions.
function Runs({ runs }: { runs: Loaded["runs"] }) {
  const t = useTranslations("objects.sheet");
  const fmt = useFmt();
  if (!runs.length)
    return <p className="py-6 text-sm text-muted-foreground">{t("noRuns")}</p>;
  return (
    <div className="space-y-4 py-2">
      {runs.map((r) => (
        <div key={r.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.workflowName}</span>
            <Badge variant={STATUS[r.status] ?? "outline"}>{r.status}</Badge>
            <span className="text-xs text-muted-foreground">
              v{r.version} · {fmt(r.createdAt)}
            </span>
          </div>
          {r.error && <p className="mt-1 text-destructive">{r.error}</p>}
          <ol className="mt-2 space-y-1.5">
            {r.steps.map((s) => {
              const out = (s.output ?? {}) as {
                reason?: string;
                confidence?: number;
              };
              return (
                <li key={s.id} className="border-l-2 pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{s.stepId}</span>
                    {s.branch && <Badge variant="outline">→ {s.branch}</Badge>}
                    {s.durationMs != null && (
                      <span className="text-xs text-muted-foreground">
                        {t("duration", { ms: s.durationMs })}
                      </span>
                    )}
                  </div>
                  {typeof out.reason === "string" && (
                    <p className="mt-0.5 text-muted-foreground italic">
                      {t("reason", { reason: out.reason })}
                      {typeof out.confidence === "number" &&
                        ` ${t("confidence", { value: out.confidence })}`}
                    </p>
                  )}
                  {s.error && <p className="text-destructive">{s.error}</p>}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
