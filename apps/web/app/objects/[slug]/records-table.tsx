"use client";

import { useErrorText } from "@/lib/error-text";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { Columns3, Plus, X } from "lucide-react";
import type { Field } from "@getrunbase/core/objects/fields";
import { FIELD_ICONS as ICONS } from "@/lib/field-icons";
import { QuotaLink } from "@/components/quota-link";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@getrunbase/ui/components/ui/table";
import {
  deleteRecords,
  deleteView,
  listViews,
  runWorkflow,
  saveView,
  searchRecords,
  updateCell,
  type Row,
  type SavedView,
} from "./actions";
import {
  filterToPills,
  needsValue,
  opsFor,
  pillsToFilter,
  type Op,
  type Pill,
} from "./table";
import type { Filter } from "@getrunbase/core/filter";
import { useRecordColumns } from "./records-columns";
import { PillValue } from "./pill-value";
import { ViewMenu } from "./view-menu";

// Cells live in ./cells; re-exported to keep existing imports working.
export { Cell, RefLinks, useCellFormat } from "./cells";

// Records table view: shadcn Data Table pattern (TanStack Table),
// server-side filter, sort and pagination (only the current page is loaded).
export function RecordsTable({
  onOpen,
  objectId,
  fields,
  workflows,
  actions,
}: {
  objectId: string;
  fields: Field[];
  workflows: { id: string; name: string }[];
  onOpen: (id: string) => void;
  // Buttons added to the toolbar (import, export).
  actions?: React.ReactNode;
}) {
  const t = useTranslations("objects.table");
  const tc = useTranslations("common");
  const tOps = useTranslations("objects.ops");
  const [rows, setRows] = useState<Row[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  // Keyset cursor of each page already reached (page 0: none).
  const cursors = useRef<(string | undefined)[]>([undefined]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pills, setPills] = useState<Pill[]>([]);
  // Active saved view; `baseFilter`: its filter if it does not translate
  // to pills ("or" groups, relation paths…), applied as is.
  const [views, setViews] = useState<SavedView[]>([]);
  const [view, setView] = useState<string>();
  const [baseFilter, setBaseFilter] = useState<Filter | null>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [error, setErrorText] = useState<string>();
  const [quota, setQuota] = useState(false);
  const errorText = useErrorText();
  // Action errors arrive as serializable items: translated here.
  const setError = (e?: unknown, q = false) => {
    setErrorText(e ? errorText(e) : undefined);
    setQuota(q);
  };
  const [reload, setReload] = useState(0);
  const [pending, startTransition] = useTransition();

  const filter = useMemo(() => {
    const own = pillsToFilter(fields, pills);
    return baseFilter && own ? { all: [baseFilter, own] } : (baseFilter ?? own);
  }, [fields, pills, baseFilter]);

  useEffect(() => {
    listViews(objectId).then((res) => setViews(res.data ?? []));
  }, [objectId]);

  function applyView(v?: SavedView) {
    setView(v?.name);
    const asPills = v ? filterToPills(fields, v.filter) : [];
    setPills(asPills ?? []);
    setBaseFilter(asPills ? null : (v?.filter ?? null));
    setSorting(
      (v?.sort ?? []).map((x) => ({ id: x.field, desc: x.dir === "desc" })),
    );
    setHidden(
      Object.fromEntries(
        fields.map((f) => [f.key, !!v?.columns && !v.columns.includes(f.key)]),
      ),
    );
    setPage(0);
  }

  async function storeView(name: string) {
    const res = await saveView(objectId, {
      name,
      filter: filter ?? null,
      sort: sorting.map((x) => ({ field: x.id, dir: x.desc ? "desc" : "asc" })),
      columns: Object.values(hidden).some(Boolean)
        ? fields.filter((f) => !hidden[f.key]).map((f) => f.key)
        : null,
    });
    if (res.error) return setError(res.error);
    setView(name);
    setViews((await listViews(objectId)).data ?? []);
  }
  const filterKey = JSON.stringify(filter);
  const refKeys = useMemo(
    () =>
      fields
        .filter((f) => f.type === "ref" || f.type === "refs")
        .map((f) => f.key),
    [fields],
  );

  useEffect(() => {
    let live = true;
    startTransition(async () => {
      const res = await searchRecords(objectId, {
        filter,
        sort: sorting.map((s) => ({
          field: s.id,
          dir: s.desc ? "desc" : "asc",
        })),
        after: cursors.current[page],
        refs: refKeys,
      });
      if (!live) return;
      cursors.current[page + 1] = res.data?.next ?? undefined;
      setLabels(res.data?.labels ?? {});
      setError(res.error);
      setRows(res.data?.rows ?? []);
      setHasMore(res.data?.hasMore ?? false);
      setSelection({});
    });
    return () => {
      live = false;
    };
  }, [objectId, filterKey, sorting, page, reload, refKeys]);

  async function save(id: string, key: string, value: unknown) {
    const res = await updateCell(id, key, value);
    if (res.error) return setError(res.error);
    setRows((rs) =>
      rs.map((r) => (r.id === id ? { ...r, data: res.data! } : r)),
    );
  }

  const columns = useRecordColumns({
    fields,
    onOpen,
    labels,
    setLabels,
    save,
  });

  const hidden_ = useMemo(
    () => Object.fromEntries(Object.entries(hidden).map(([k, v]) => [k, !v])),
    [hidden],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    state: { sorting, rowSelection: selection, columnVisibility: hidden_ },
    onSortingChange: (u) => {
      setSorting(u);
      setPage(0);
    },
    onRowSelectionChange: setSelection,
  });

  const selected = Object.keys(selection);
  const setPill = (i: number, p: Partial<Pill>) => {
    setPills((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));
    setPage(0);
  };

  async function act(fn: () => Promise<{ error?: unknown }>) {
    const res = await fn();
    setError(res.error);
    setReload((n) => n + 1);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {pills.map((p, i) => {
          const f = fields.find((x) => x.key === p.field)!;
          return (
            <div
              key={i}
              className="flex h-7 items-center gap-1 rounded-full border bg-muted/50 pl-3 pr-1 text-xs"
            >
              <span className="font-medium">{f.label}</span>
              <Select value={p.op} onValueChange={(op) => setPill(i, { op })}>
                <SelectTrigger size="sm" className="h-6 border-0 shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opsFor(f).map((op) => (
                    <SelectItem key={op} value={op}>
                      {tOps(op as Op)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {needsValue(p.op) && (
                <PillValue
                  field={f}
                  value={p.value}
                  onChange={(value) => setPill(i, { value })}
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-5 rounded-full"
                aria-label={t("removeFilter")}
                onClick={() => {
                  setPills((ps) => ps.filter((_, j) => j !== i));
                  setPage(0);
                }}
              >
                <X className="size-3" />
              </Button>
            </div>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7">
              <Plus className="size-3.5" /> {t("filter")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {fields
              .filter((f) => opsFor(f).length)
              .map((f) => {
                const Icon = ICONS[f.type];
                return (
                  <DropdownMenuItem
                    key={f.key}
                    onSelect={() =>
                      setPills((ps) => [
                        ...ps,
                        { field: f.key, op: opsFor(f)[0]!, value: "" },
                      ])
                    }
                  >
                    <Icon /> {f.label}
                  </DropdownMenuItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7">
              <Columns3 className="size-3.5" /> {t("columns")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t("visibleColumns")}</DropdownMenuLabel>
            {fields.map((f) => (
              <DropdownMenuCheckboxItem
                key={f.key}
                checked={!hidden[f.key]}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(v) =>
                  setHidden((h) => ({ ...h, [f.key]: !v }))
                }
              >
                {f.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ViewMenu
          views={views}
          current={view}
          onApply={applyView}
          onSave={storeView}
          onDelete={async (name) => {
            const res = await deleteView(objectId, name);
            if (res.error) return setError(res.error);
            if (view === name) applyView(undefined);
            setViews((await listViews(objectId)).data ?? []);
          }}
        />

        <Button
          size="sm"
          className="h-7"
          // Opens an empty form: the record is created on save, so
          // required fields can be filled first.
          onClick={() => onOpen("new")}
        >
          <Plus className="size-3.5" /> {t("newRecord")}
        </Button>
        {actions}

        {selected.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {t("selected", { count: selected.length })}
            </span>
            {workflows.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7">
                    {t("runWorkflow")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {workflows.map((w) => (
                    <DropdownMenuItem
                      key={w.id}
                      onSelect={() => act(() => runWorkflow(w.id, selected))}
                    >
                      {w.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="destructive"
              size="sm"
              className="h-7"
              onClick={() => {
                if (confirm(t("confirmTrash", { count: selected.length })))
                  act(() => deleteRecords(selected));
              }}
            >
              {tc("delete")}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-destructive">{error}</p>
          <QuotaLink show={quota} />
        </div>
      )}

      <div className="rounded-md border">
        <Table className={pending ? "opacity-60" : undefined}>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="h-9">
                {hg.headers.map((h) => (
                  <TableHead
                    key={h.id}
                    className="h-9 border-r last:border-r-0"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="h-9"
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((c) => (
                  <TableCell
                    key={c.id}
                    className="h-9 max-w-64 truncate border-r py-0 last:border-r-0"
                  >
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {pending ? tc("loading") : t("empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">
          {t("page", { page: page + 1 })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0 || pending}
          onClick={() => setPage((p) => p - 1)}
        >
          {t("previous")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasMore || pending}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
