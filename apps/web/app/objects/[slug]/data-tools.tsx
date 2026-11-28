"use client";

import { useErrorText } from "@/lib/error-text";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Download, Info, RotateCcw, Trash2, Upload } from "lucide-react";
import { recordTitle, type Field } from "@getrunbase/core/objects/fields";
import { parseCsv } from "@getrunbase/core/records/csv";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
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
import { emptyTrash, importRecords, listTrash, restoreRecord } from "./actions";

// Download of all records (streamed route, no limit).
export function ExportMenu({ slug }: { slug: string }) {
  const t = useTranslations("objects.export");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7">
          <Download className="size-3.5" /> {t("button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={`/objects/${slug}/export?format=csv`} download>
            {t("csv")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`/objects/${slug}/export?format=json`} download>
            {t("json")}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SKIP = "__skip";
const NO_MATCH = "__none";
type Report = NonNullable<Awaited<ReturnType<typeof importRecords>>["data"]>;

// Column -> field: same key or same label, case-insensitive.
function guess(col: string, fields: Field[]) {
  const c = col.trim().toLowerCase();
  return (
    fields.find((f) => f.key === c || f.label.toLowerCase() === c)?.key ?? SKIP
  );
}

// CSV file import: file choice, column mapping,
// check (nothing is written), then import.
export function ImportDialog({
  objectId,
  fields,
  onDone,
}: {
  objectId: string;
  fields: Field[];
  onDone: () => void;
}) {
  const t = useTranslations("objects.import");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [match, setMatch] = useState(NO_MATCH);
  const [report, setReport] = useState<Report>();
  const [error, setErrorRaw] = useState<string>();
  const errorText = useErrorText();
  // Action errors arrive as serializable items: translated here.
  const setError = (e?: unknown) => setErrorRaw(e ? errorText(e) : undefined);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function reset() {
    setCsv("");
    setColumns([]);
    setMapping({});
    setMatch(NO_MATCH);
    setReport(undefined);
    setError(undefined);
    setDone(false);
  }

  async function pick(file?: File) {
    reset();
    if (!file) return;
    const text = await file.text();
    const header = parseCsv(text)[0] ?? [];
    setCsv(text);
    setColumns(header);
    const m = Object.fromEntries(header.map((c) => [c, guess(c, fields)]));
    setMapping(m);
    const unique = fields.find(
      (f) => f.unique && Object.values(m).includes(f.key),
    );
    setMatch(unique?.key ?? NO_MATCH);
  }

  const chosen = Object.fromEntries(
    Object.entries(mapping).filter(([, k]) => k !== SKIP),
  );
  const uniques = fields.filter(
    (f) => f.unique && Object.values(chosen).includes(f.key),
  );

  async function submit(dryRun: boolean) {
    setBusy(true);
    const res = await importRecords(objectId, {
      csv,
      mapping: chosen,
      match: match === NO_MATCH ? undefined : match,
      dryRun,
    });
    setBusy(false);
    setError(res.error);
    setReport(res.data);
    if (res.data && !dryRun) {
      setDone(true);
      onDone();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7">
          <Upload className="size-3.5" /> {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="csv-file">{t("file")}</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
          {columns.length > 0 && (
            <>
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("column")}</TableHead>
                      <TableHead>{t("field")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {columns.map((c) => (
                      <TableRow key={c}>
                        <TableCell className="font-medium">{c}</TableCell>
                        <TableCell>
                          <Select
                            value={mapping[c] ?? SKIP}
                            onValueChange={(v) => {
                              setMapping((m) => ({ ...m, [c]: v }));
                              setReport(undefined);
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SKIP}>{t("skip")}</SelectItem>
                              {fields.map((f) => (
                                <SelectItem key={f.key} value={f.key}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-2">
                <Label>{t("dedupe")}</Label>
                <Select
                  value={match}
                  onValueChange={(v) => {
                    setMatch(v);
                    setReport(undefined);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_MATCH}>
                      {t("alwaysCreate")}
                    </SelectItem>
                    {uniques.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {t("updateSame", { field: f.label })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {uniques.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("dedupeHint")}
                  </p>
                )}
              </div>
            </>
          )}
          {report && (
            <div className="space-y-1 rounded-md border p-3 text-sm">
              <p className="font-medium">{done ? t("done") : t("dryRun")}</p>
              <p>
                {t("report", {
                  created: report.created,
                  updated: report.updated,
                  unchanged: report.unchanged,
                  failed: report.failedCount,
                })}
              </p>
              {report.failed.length > 0 && (
                <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-destructive">
                  {report.failed.map((f, i) => (
                    <li key={i}>
                      {t("lineError", {
                        line: f.line,
                        error: f.field ? `${f.field}: ${f.message}` : f.message,
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          {done ? (
            <Button onClick={() => setOpen(false)}>{tc("close")}</Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={!csv || busy || !Object.keys(chosen).length}
                onClick={() => submit(true)}
              >
                {t("check")}
              </Button>
              <Button disabled={!report || busy} onClick={() => submit(false)}>
                {t("button")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Trashed = NonNullable<Awaited<ReturnType<typeof listTrash>>["data"]>;

// Trash: deleted records, restorable until their automatic
// permanent deletion.
export function TrashList({
  objectId,
  fields,
}: {
  objectId: string;
  fields: Field[];
}) {
  const t = useTranslations("objects.trash");
  const tc = useTranslations("common");
  const format = useFormatter();
  // Days left before automatic deletion (NR5ei board).
  const daysLeft = (d: Date | string) =>
    Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000));
  const [rows, setRows] = useState<Trashed>();
  const [error, setErrorRaw] = useState<string>();
  const errorText = useErrorText();
  // Action errors arrive as serializable items: translated here.
  const setError = (e?: unknown) => setErrorRaw(e ? errorText(e) : undefined);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    listTrash(objectId).then((res) => {
      setError(res.error);
      setRows(res.data);
    });
  }, [objectId, reload]);

  async function act(fn: () => Promise<{ error?: unknown }>) {
    const res = await fn();
    setError(res.error);
    setReload((n) => n + 1);
  }

  if (!rows)
    return (
      <p className="py-6 text-sm text-muted-foreground">{tc("loading")}</p>
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="size-4" />
          {t("hint")}
        </p>
        {rows.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                {t("empty")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("emptyTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("emptyDescription", { count: rows.length })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => act(() => emptyTrash(objectId))}
                >
                  {t("emptyConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t("isEmpty")}</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("record")}</TableHead>
                <TableHead>{t("deletedAt")}</TableHead>
                <TableHead>{t("purgeAt")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {recordTitle(fields, r)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.relativeTime(new Date(r.deletedAt))}
                  </TableCell>
                  <TableCell
                    className={
                      daysLeft(r.purgeAt) <= 7
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {t("daysLeft", { count: daysLeft(r.purgeAt) })}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => act(() => restoreRecord(r.id))}
                    >
                      <RotateCcw /> {tc("restore")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => {
                        if (confirm(t("eraseConfirm")))
                          act(() => emptyTrash(objectId, [r.id]));
                      }}
                    >
                      <Trash2 /> {t("erase")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
