"use client";

import { useState } from "react";
import { ChevronRight, FileSpreadsheet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ConnectionSelect,
  useGooglePicker,
} from "@/components/connection-select";
import { useErrorText } from "@/lib/error-text";
import { pickerToken } from "../actions";
import type { VarScope } from "../variables";
import { OptionsSelect, useOptions } from "./dynamic-options";
import { PillInput } from "./pickers";
import { JsonInput, type StepInput } from "./step-form-fields";

// Google Sheets steps (read, add, update): account, file picked in Drive,
// tab and columns from the sheet; rarer inputs under "Advanced options".

const PROVIDER = "google";

// "Leads!A2:C" -> ["Leads", "A2:C"].
const splitRange = (r: unknown): [string, string] => {
  const s = typeof r === "string" ? r : "";
  const i = s.indexOf("!");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
};
const joinRange = (tab: string, cells: string) =>
  tab && cells ? `${tab}!${cells}` : tab || undefined;

// Minimal typing of the Google Picker API (https://developers.google.com/drive/picker).
type PickerData = { action: string; docs?: { id: string; name?: string }[] };
type GooglePicker = {
  ViewId: { SPREADSHEETS: unknown };
  Action: { PICKED: string };
  DocsView: new (id: unknown) => {
    setIncludeFolders: (b: boolean) => unknown;
  };
  PickerBuilder: new () => PickerBuilder;
};
type PickerBuilder = {
  addView: (v: unknown) => PickerBuilder;
  setOAuthToken: (t: string) => PickerBuilder;
  setDeveloperKey: (k: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setCallback: (f: (d: PickerData) => void) => PickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
};
type Gapi = { load: (lib: string, cb: () => void) => void };
type PickerWindow = Window & {
  gapi?: Gapi;
  google?: { picker?: GooglePicker };
};

let loading: Promise<GooglePicker> | undefined;
// Loads https://apis.google.com/js/api.js then the picker library, once.
function loadPicker(): Promise<GooglePicker> {
  const w = window as PickerWindow;
  if (w.google?.picker) return Promise.resolve(w.google.picker);
  loading ??= new Promise<GooglePicker>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onerror = () => {
      loading = undefined;
      reject(new Error("Google Picker failed to load"));
    };
    s.onload = () => w.gapi!.load("picker", () => resolve(w.google!.picker!));
    document.head.appendChild(s);
  });
  return loading;
}

// "Choose in Drive": Google Picker filtered to spreadsheets, opened with the
// connection's own short-lived token. With `drive.file`, picking a file
// grants the app access to it (needs the project number as app id).
function DrivePicker({
  type,
  connection,
  value,
  scope,
  onPick,
}: {
  type: string;
  connection?: string;
  value: StepInput;
  scope: VarScope;
  onPick: (id: string, name: string) => void;
}) {
  const t = useTranslations("workflows.stepForm");
  const errorText = useErrorText();
  const config = useGooglePicker();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string }>();
  const id = typeof value.spreadsheetId === "string" ? value.spreadsheetId : "";
  // Name of a file picked earlier (not kept in the step input).
  const named = useOptions(
    type,
    "spreadsheetId",
    value,
    ["spreadsheetId"],
    !!id && picked?.id !== id,
  );
  const name =
    picked?.id === id
      ? picked.name
      : (named.options.find((o) => o.value === id)?.label ?? id);

  const open = async () => {
    if (!config) return;
    setBusy(true);
    setError(undefined);
    try {
      const [r, picker] = await Promise.all([
        pickerToken(PROVIDER, connection),
        loadPicker(),
      ]);
      if (r.error || !r.data) {
        setError(r.error ? errorText(r.error) : undefined);
        return;
      }
      const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
      view.setIncludeFolders(true);
      new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(r.data)
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setCallback((d) => {
          const doc = d.action === picker.Action.PICKED ? d.docs?.[0] : null;
          if (!doc) return;
          setPicked({ id: doc.id, name: doc.name ?? doc.id });
          onPick(doc.id, doc.name ?? doc.id);
        })
        .build()
        .setVisible(true);
    } catch {
      setError(t("pickerFailed"));
    } finally {
      setBusy(false);
    }
  };

  // Picker not configured on this instance: the id typed by hand.
  if (!config)
    return (
      <div className="space-y-1">
        <PillInput
          ariaLabel={t("spreadsheetIdManual")}
          scope={scope}
          value={id}
          onChange={(v) => onPick(v, v)}
        />
        <p className="text-muted-foreground text-xs">
          {t("pickerNotConfigured")}
        </p>
      </div>
    );
  return (
    <div className="space-y-1">
      {id && (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <FileSpreadsheet className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate">
            {named.loading && picked?.id !== id ? t("optionsLoading") : name}
          </span>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void open()}
      >
        {id ? t("changeFile") : t("chooseInDrive")}
      </Button>
      {(error || named.error) && (
        <p role="alert" className="text-destructive text-xs">
          {error ?? named.error}
        </p>
      )}
    </div>
  );
}

// One field per column of the header row: values of the single added row.
function ColumnsMapping({
  type,
  value,
  scope,
  onChange,
}: {
  type: string;
  value: StepInput;
  scope: VarScope;
  onChange: (row: Record<string, string> | undefined) => void;
}) {
  const t = useTranslations("workflows.stepForm");
  const { options, error, loading } = useOptions(
    type,
    "rows",
    value,
    ["spreadsheetId", "range"],
    !!value.spreadsheetId && !!value.range,
  );
  const rows = Array.isArray(value.rows) ? value.rows : [];
  const row =
    rows.length === 1 && rows[0] && typeof rows[0] === "object"
      ? (rows[0] as Record<string, unknown>)
      : {};
  if (!value.spreadsheetId || !value.range) return null;
  const set = (col: string, v: string) => {
    const next: Record<string, string> = {};
    for (const [k, x] of Object.entries(row))
      if (typeof x === "string") next[k] = x;
    if (v) next[col] = v;
    else delete next[col];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <div className="space-y-1">
      <Label>{t("columns")} *</Label>
      {loading && (
        <p className="text-muted-foreground text-xs">{t("optionsLoading")}</p>
      )}
      {!loading && !error && !options.length && (
        <p className="text-muted-foreground text-xs">{t("noColumns")}</p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-2">
        {options.map((o) => (
          <div key={o.value} className="contents">
            <span className="truncate text-sm">{o.label}</span>
            <PillInput
              ariaLabel={o.label}
              placeholder={t("columnEmpty")}
              scope={scope}
              value={String(row[o.value] ?? "")}
              onChange={(v) => set(o.value, v)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SheetsForm({
  type,
  value,
  onChange,
  scope,
}: {
  type: string;
  value: StepInput;
  onChange: (v: StepInput) => void;
  scope: VarScope;
}) {
  const t = useTranslations("workflows.stepForm");
  const tl = useTranslations("workflows.labels.input");
  const action = type.split(".").at(-1);
  const set = (patch: StepInput) => {
    const next = { ...value, ...patch };
    for (const [k, v] of Object.entries(next))
      if (v === undefined || v === "") delete next[k];
    onChange(next);
  };
  const [tab, cells] = splitRange(value.range);
  // A single row of mapped columns; anything else is edited as JSON.
  const mapped =
    !Array.isArray(value.rows) ||
    (value.rows.length <= 1 &&
      value.rows.every((r) => r && typeof r === "object" && !Array.isArray(r)));
  const cellsInput = (
    <div className="space-y-1">
      <Label>
        {t("cells")}
        {action === "update_rows" && " *"}
      </Label>
      <Input
        placeholder="A2:C10"
        value={cells}
        onChange={(e) => set({ range: joinRange(tab, e.target.value.trim()) })}
      />
      <p className="text-muted-foreground text-xs">{t("cellsHelp")}</p>
    </div>
  );
  const advanced =
    action === "read_rows" ? (
      <>
        {cellsInput}
        <div className="flex items-center justify-between gap-2">
          <Label>{t("firstRowHeaders")}</Label>
          <Switch
            checked={value.headers !== false}
            onCheckedChange={(c) => set({ headers: c })}
          />
        </div>
      </>
    ) : action === "append_rows" ? (
      <div className="space-y-1">
        <Label>{t("rowsJson")}</Label>
        <JsonInput
          key={JSON.stringify(value.rows ?? null)}
          value={value.rows}
          onChange={(v) => set({ rows: v })}
        />
        <p className="text-muted-foreground text-xs">{t("rowsJsonHelp")}</p>
      </div>
    ) : null;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{tl("connection")}</Label>
        <ConnectionSelect
          provider={PROVIDER}
          value={value.connection as string | undefined}
          onChange={(n) => set({ connection: n })}
        />
      </div>
      <div className="space-y-1">
        <Label>{tl("spreadsheetId")} *</Label>
        <DrivePicker
          type={type}
          scope={scope}
          connection={value.connection as string | undefined}
          value={value}
          onPick={(id) =>
            id !== value.spreadsheetId &&
            set({ spreadsheetId: id, range: undefined, rows: undefined })
          }
        />
      </div>
      {!!value.spreadsheetId && (
        <div className="space-y-1">
          <Label>{tl("range")} *</Label>
          <OptionsSelect
            type={type}
            field="range"
            input={value}
            deps={["spreadsheetId"]}
            value={tab || undefined}
            onChange={(v) =>
              set({
                range: joinRange(v, cells),
                ...(v !== tab &&
                  action === "append_rows" && { rows: undefined }),
              })
            }
          />
        </div>
      )}
      {action === "update_rows" && !!value.spreadsheetId && (
        <>
          {cellsInput}
          <div className="space-y-1">
            <Label>{tl("values")} *</Label>
            <JsonInput
              key={JSON.stringify(value.values ?? null)}
              value={value.values}
              onChange={(v) => set({ values: v })}
            />
          </div>
        </>
      )}
      {action === "append_rows" && mapped && (
        <ColumnsMapping
          type={type}
          value={value}
          scope={scope}
          onChange={(row) => set({ rows: row ? [row] : undefined })}
        />
      )}
      {advanced && (
        <Collapsible>
          <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            {t("advanced")}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            {advanced}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
