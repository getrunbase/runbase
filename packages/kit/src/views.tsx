/** @jsxRuntime automatic */
// Data-bound record views: DataTable, Kanban, Calendar, Timeline,
// Gallery. Schema read by useObject, rows by useQuery.
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Filter, Row } from "@getrunbase/sdk";
import { Badge } from "@ui/badge";
import { Button } from "@ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ui/card";
import { Input } from "@ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ui/table";
import { sdk } from "./sdk";
import { BlockState, labelsOf, type Labels } from "./state";
import { byDay, isoDay, monthGrid } from "./form";
import {
  at,
  cellText,
  columnsFromFields,
  initials,
  numeric,
  titleOf,
  type Col,
  type Field,
} from "./table";

type Common = { labels?: Labels; locale?: string };

// Schema fields of an object (useObject).
export function useFields(object: string) {
  const o = sdk().useObject(object);
  const fields = ((o.data as { fields?: Field[] } | undefined)?.fields ??
    []) as Field[];
  return { ...o, fields };
}

function Cell({ v, col, l, locale }: { v: unknown; col: Col; l: ReturnType<typeof labelsOf>; locale?: string }) {
  const text = cellText(v, col, { locale, yesNo: [l.yes, l.no] });
  if (col.type === "badge" && text) return <Badge variant="secondary">{text}</Badge>;
  return <>{text}</>;
}

export type DataTableProps = Common & {
  object: string;
  // Keys of the displayed fields (default: all readable fields).
  fields?: string[];
  filter?: Filter;
  limit?: number;
  // Height of the scrolling area (virtualized rows).
  height?: number;
  searchable?: boolean;
  onRowClick?: (row: Row) => void;
};

// Table: columns derived from the schema, server-side sort and search, virtualized
// rows.
export function DataTable({
  object,
  fields: only,
  filter,
  limit = 200,
  height = 480,
  searchable = true,
  onRowClick,
  labels,
  locale,
}: DataTableProps) {
  const l = labelsOf(labels);
  const schema = useFields(object);
  const [q, setQ] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const s = sorting[0];
  const res = sdk().useQuery({
    object,
    filter,
    limit,
    ...(q.trim() && { q: q.trim() }),
    ...(s && {
      sort: [{ field: s.id.replace(/^data\./, ""), dir: s.desc ? "desc" : "asc" }],
    }),
  });
  const cols = columnsFromFields(schema.fields, only);
  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      cols.map((c) => ({
        id: c.key,
        header: c.label,
        accessorFn: (r) => at(r, c.key),
        cell: (i) => <Cell v={i.getValue()} col={c} l={l} locale={locale} />,
      })),
    [JSON.stringify(cols), locale, l.yes, l.no],
  );
  const table = useReactTable({
    data: res.data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;
  const scroll = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 41,
    overscan: 10,
    // Server render (captures, tests): first window without DOM measurement.
    initialRect: { width: 0, height },
  });
  const items = v.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = v.getTotalSize() - (items.at(-1)?.end ?? 0);
  return (
    <div className="flex flex-col gap-2" data-kit="data-table">
      {searchable && (
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={l.search}
          className="max-w-xs"
        />
      )}
      <BlockState
        loading={(schema.loading || res.loading) && !res.data.length}
        error={schema.error ?? res.error}
        empty={!res.data.length}
        labels={labels}
      >
        <div ref={scroll} className="overflow-auto rounded-md border" style={{ maxHeight: height }}>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((g) => (
                <TableRow key={g.id}>
                  {g.headers.map((h) => {
                    const dir = h.column.getIsSorted();
                    return (
                      <TableHead
                        key={h.id}
                        onClick={h.column.getToggleSortingHandler()}
                        aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : "none"}
                        className="cursor-pointer select-none"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? " ↑" : dir === "desc" ? " ↓" : ""}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {before > 0 && <tr style={{ height: before }} />}
              {items.map((it) => {
                const r = rows[it.index]!;
                return (
                  <TableRow
                    key={r.id}
                    onClick={onRowClick && (() => onRowClick(r.original))}
                    className={onRowClick && "cursor-pointer"}
                  >
                    {r.getVisibleCells().map((c, i) => (
                      <TableCell key={c.id} className={numeric(cols[i]!) ? "text-right tabular-nums" : undefined}>
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
              {after > 0 && <tr style={{ height: after }} />}
            </TableBody>
          </Table>
        </div>
      </BlockState>
    </div>
  );
}

export type KanbanProps = Common & {
  object: string;
  // Select field that defines the columns.
  groupBy: string;
  titleField?: string;
  // Field shown under the title (amount, owner…).
  subtitleField?: string;
  filter?: Filter;
  onCardClick?: (row: Row) => void;
};

function KanbanCard({ row, title, subtitle, onClick }: { row: Row; title: string; subtitle: string; onClick?: () => void }) {
  const d = useDraggable({ id: row.id });
  const t = d.transform;
  return (
    <Card
      ref={d.setNodeRef}
      {...d.listeners}
      {...d.attributes}
      onClick={onClick}
      className="cursor-grab gap-1 py-3"
      style={t ? { transform: `translate(${t.x}px, ${t.y}px)` } : undefined}
    >
      <CardHeader className="px-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </CardHeader>
    </Card>
  );
}

function KanbanColumn({ id, label, count, children }: { id: string; label: string; count: number; children: ReactNode }) {
  const d = useDroppable({ id });
  return (
    <div
      ref={d.setNodeRef}
      className={`flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-muted/50 p-2 ${d.isOver ? "ring-2 ring-ring" : ""}`}
    >
      <div className="flex items-center justify-between px-1 text-sm font-medium">
        <span>{label}</span>
        <Badge variant="outline">{count}</Badge>
      </div>
      {children}
    </div>
  );
}

// Kanban: one column per option of the `groupBy` field; dragging a card
// updates the record (optimistic mutation).
export function Kanban({
  object,
  groupBy,
  titleField,
  subtitleField,
  filter,
  onCardClick,
  labels,
  locale,
}: KanbanProps) {
  const l = labelsOf(labels);
  const s = sdk();
  const schema = useFields(object);
  const res = s.useQuery({ object, filter, limit: 500 });
  const { update } = s.useMutation(object);
  const field = schema.fields.find((f) => f.key === groupBy);
  const sub = schema.fields.find((f) => f.key === subtitleField);
  const subCol = sub && columnsFromFields([sub])[0];
  const lanes = field?.options ?? [
    ...new Set(res.data.map((r) => String(at(r, `data.${groupBy}`) ?? ""))),
  ];
  const onDragEnd = (e: DragEndEvent) => {
    const row = res.data.find((r) => r.id === e.active.id);
    const to = e.over?.id;
    if (row && to != null && at(row, `data.${groupBy}`) !== to)
      void update(row.id, { [groupBy]: to }, { optimistic: true });
  };
  return (
    <BlockState
      loading={(schema.loading || res.loading) && !res.data.length}
      error={schema.error ?? res.error}
      empty={!lanes.length}
      labels={labels}
    >
      <DndContext onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2" data-kit="kanban">
          {lanes.map((lane) => {
            const cards = res.data.filter((r) => String(at(r, `data.${groupBy}`) ?? "") === lane);
            return (
              <KanbanColumn key={lane} id={lane} label={lane || l.none} count={cards.length}>
                {cards.map((r) => (
                  <KanbanCard
                    key={r.id}
                    row={r}
                    title={titleOf(r, titleField)}
                    subtitle={subCol ? cellText(at(r, subCol.key), subCol, { locale }) : ""}
                    onClick={onCardClick && (() => onCardClick(r))}
                  />
                ))}
              </KanbanColumn>
            );
          })}
        </div>
      </DndContext>
    </BlockState>
  );
}

export type CalendarProps = Common & {
  object: string;
  dateField: string;
  titleField?: string;
  // Month shown initially (YYYY-MM), default: current month.
  month?: string;
  filter?: Filter;
  onSelect?: (row: Row) => void;
};

// Monthly calendar: records placed on the day of `dateField`.
export function Calendar({
  object,
  dateField,
  titleField,
  month,
  filter,
  onSelect,
  labels,
  locale,
}: CalendarProps) {
  const l = labelsOf(labels);
  const init = month ? new Date(`${month}-01T00:00:00`) : new Date();
  const [ym, setYm] = useState({ y: init.getFullYear(), m: init.getMonth() });
  const weeks = monthGrid(ym.y, ym.m);
  const res = sdk().useQuery({
    object,
    limit: 500,
    filter: {
      all: [
        ...(filter ? [filter] : []),
        { field: dateField, op: "gte", value: weeks[0]![0] },
        { field: dateField, op: "lte", value: `${weeks.at(-1)![6]}T23:59:59` },
      ],
    },
  });
  const days = byDay(res.data, (r) => at(r, `data.${dateField}`));
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, o);
  const go = (d: number) =>
    setYm(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));
  const today = isoDay(new Date());
  return (
    <div className="flex flex-col gap-2" data-kit="calendar">
      <div className="flex items-center justify-between">
        <span className="font-medium capitalize">
          {fmt({ month: "long", year: "numeric" }).format(new Date(ym.y, ym.m, 1))}
        </span>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => go(-1)}>{l.previous}</Button>
          <Button variant="outline" size="sm" onClick={() => go(1)}>{l.next}</Button>
        </div>
      </div>
      <BlockState loading={res.loading && !res.data.length} error={res.error} labels={labels}>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border text-sm">
          {weeks[0]!.map((d) => (
            <div key={d} className="bg-muted p-1 text-center text-xs text-muted-foreground">
              {fmt({ weekday: "short" }).format(new Date(`${d}T00:00:00`))}
            </div>
          ))}
          {weeks.flat().map((d) => (
            <div
              key={d}
              className={`min-h-20 bg-background p-1 ${Number(d.slice(5, 7)) - 1 !== ym.m ? "text-muted-foreground" : ""}`}
            >
              <div className={`text-xs ${d === today ? "font-bold text-primary" : ""}`}>{Number(d.slice(8))}</div>
              {(days.get(d) ?? []).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={onSelect && (() => onSelect(r))}
                  className="mt-0.5 block w-full truncate rounded bg-primary/10 px-1 text-left text-xs"
                >
                  {titleOf(r, titleField)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </BlockState>
    </div>
  );
}

type Event = {
  id?: string;
  type?: string;
  occurredAt?: string;
  createdAt?: string;
  payload?: Record<string, unknown>;
};

export type TimelineProps = Common & {
  recordId: string;
  // Label per event type (`email.sent` -> "Email sent").
  types?: Record<string, string>;
};

// Record timeline: events from newest to oldest.
export function Timeline({ recordId, types, labels, locale }: TimelineProps) {
  const res = sdk().useTimeline<Event>(recordId);
  const events = [...res.data].sort((a, b) =>
    String(b.occurredAt ?? b.createdAt).localeCompare(String(a.occurredAt ?? a.createdAt)),
  );
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <BlockState loading={res.loading && !events.length} error={res.error} empty={!events.length} labels={labels}>
      <ol className="relative flex flex-col gap-4 border-l pl-4" data-kit="timeline">
        {events.map((e, i) => {
          const at = e.occurredAt ?? e.createdAt;
          const p = e.payload ?? {};
          return (
            <li key={e.id ?? i} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" />
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{String(p.title ?? types?.[e.type ?? ""] ?? e.type ?? "")}</span>
                {at && <time className="text-xs text-muted-foreground">{when.format(new Date(at))}</time>}
              </div>
              {p.body != null && <p className="text-sm text-muted-foreground">{String(p.body)}</p>}
            </li>
          );
        })}
      </ol>
    </BlockState>
  );
}

export type GalleryProps = Common & {
  object: string;
  titleField?: string;
  // Fields shown on each card.
  fields?: string[];
  filter?: Filter;
  limit?: number;
  onSelect?: (row: Row) => void;
};

// Gallery: one card per record (initials, title, chosen fields).
export function Gallery({ object, titleField, fields, filter, limit = 60, onSelect, labels, locale }: GalleryProps) {
  const l = labelsOf(labels);
  const schema = useFields(object);
  const res = sdk().useQuery({ object, filter, limit });
  const cols = columnsFromFields(schema.fields, fields ?? []).filter(
    (c) => c.key !== `data.${titleField ?? "name"}`,
  ).slice(0, fields ? undefined : 3);
  return (
    <BlockState
      loading={(schema.loading || res.loading) && !res.data.length}
      error={schema.error ?? res.error}
      empty={!res.data.length}
      labels={labels}
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3" data-kit="gallery">
        {res.data.map((r) => {
          const title = titleOf(r, titleField);
          return (
            <Card key={r.id} onClick={onSelect && (() => onSelect(r))} className={onSelect && "cursor-pointer"}>
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
                  {initials(title)}
                </div>
                <CardTitle className="truncate">{title}</CardTitle>
              </CardHeader>
              {cols.length > 0 && (
                <CardContent className="flex flex-col gap-1 text-sm">
                  {cols.map((c) => (
                    <div key={c.key} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{c.label}</span>
                      <span className="truncate">
                        <Cell v={at(r, c.key)} col={c} l={l} locale={locale} />
                      </span>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </BlockState>
  );
}
