"use client";

import type { ActionError } from "@/lib/action-error";
import { useErrorText } from "@/lib/error-text";
import { useState } from "react";
import NextLink from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Paperclip, Star, X } from "lucide-react";
import { baseType, isComputed, type Field } from "@runbase/core/objects/fields";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@runbase/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fileUploadUrls, uploadFiles } from "./actions";
import { fileInfo, putToBucket } from "@/lib/direct-upload";
import { display, parseValue, type CellFormat } from "./table";

// Types editable inline (the others stay read-only).
const EDITABLE: Field["type"][] = [
  "text",
  "number",
  "date",
  "email",
  "url",
  "select",
  "bool",
  "currency",
  "percent",
  "phone",
  "user",
];

// Cell formatting in the user's locale.
export function useCellFormat(): CellFormat {
  const format = useFormatter();
  const tc = useTranslations("objects.cell");
  return {
    number: (v, o) => (o ? format.number(v, o) : format.number(v)),
    dateTime: (d, o) => (o ? format.dateTime(d, o) : format.dateTime(d)),
    yes: tc("yes"),
    no: tc("no"),
  };
}

// Links to linked records (ref / refs / inverse relations): open
// their record in their object's page.
export function RefLinks({
  object,
  links,
}: {
  object: string;
  links: { id: string; label: string }[];
}) {
  if (!links.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {links.map((l) => (
        <NextLink
          key={l.id}
          href={`/objects/${object}?record=${l.id}`}
          className="rounded bg-muted px-1.5 py-0.5 hover:underline"
        >
          {l.label}
        </NextLink>
      ))}
    </span>
  );
}

// Editable cell: one click (or Enter / F2) to edit, Enter or blur to confirm, Escape to cancel.
export function Cell({
  field,
  value,
  onSave,
  inline,
}: {
  field: Field;
  value: unknown;
  onSave: (v: unknown) => void;
  // Record view: one click is enough and an empty field shows "Empty".
  inline?: boolean;
}) {
  const t = useTranslations("objects.cell");
  const fmt = useCellFormat();
  const [editing, setEditing] = useState(false);
  const editable = EDITABLE.includes(field.type);

  if (field.type === "rating")
    return (
      <Rating
        value={typeof value === "number" ? value : 0}
        scale={field.scale ?? 5}
        onSave={onSave}
      />
    );
  if (field.type === "file") return <Files value={value} onSave={onSave} />;
  if (isComputed(field))
    return (
      <div className="truncate text-muted-foreground" title={t("computed")}>
        {display(value, field, fmt)}
      </div>
    );
  if (field.type === "bool")
    return (
      <Checkbox
        checked={value === true}
        onCheckedChange={(v) => onSave(v === true)}
      />
    );
  if (field.type === "select")
    return (
      <Select value={(value as string) ?? ""} onValueChange={onSave}>
        <SelectTrigger
          size="sm"
          className="h-7 w-full border-0 px-0 shadow-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  if (!editing)
    return (
      <div
        className={
          editable
            ? "flex min-h-7 w-full cursor-text items-center truncate rounded px-1 hover:bg-muted"
            : "truncate"
        }
        role={editable ? "button" : undefined}
        tabIndex={editable ? 0 : undefined}
        aria-label={editable ? t("edit", { field: field.label }) : undefined}
        onClick={() => editable && setEditing(true)}
        onKeyDown={(e) => {
          if (editable && (e.key === "Enter" || e.key === "F2"))
            setEditing(true);
        }}
      >
        {inline && editable && display(value) === "" ? (
          <span className="text-muted-foreground">{t("empty")}</span>
        ) : (
          display(value, field, fmt)
        )}
      </div>
    );
  const commit = (raw: string) => {
    setEditing(false);
    if (raw !== display(value)) onSave(parseValue(field, raw) ?? null);
  };
  return (
    <Input
      autoFocus
      className="h-7 px-1"
      type={
        field.type === "date"
          ? "date"
          : baseType(field) === "number"
            ? "number"
            : field.type === "phone"
              ? "tel"
              : field.type === "email"
                ? "email"
                : field.type === "url"
                  ? "url"
                  : "text"
      }
      defaultValue={display(value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget.value);
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

// Star rating: a click sets the rating, a click on the current rating clears it.
function Rating({
  value,
  scale,
  onSave,
}: {
  value: number;
  scale: number;
  onSave: (v: unknown) => void;
}) {
  const t = useTranslations("objects.cell");
  return (
    <div
      className="flex items-center"
      role="radiogroup"
      aria-label={t("rating")}
    >
      {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t("ratingValue", { n, scale })}
          className="p-0.5"
          onClick={() => onSave(value === n ? null : n)}
        >
          <Star
            className={
              n <= value
                ? "size-3.5 fill-primary text-primary"
                : "size-3.5 text-muted-foreground"
            }
          />
        </button>
      ))}
    </div>
  );
}

type FileValue = { key: string; name: string; size: number; type: string };

// File attachments: download links, add and remove.
function Files({
  value,
  onSave,
}: {
  value: unknown;
  onSave: (v: unknown) => void;
}) {
  const files = (Array.isArray(value) ? value : []) as FileValue[];
  const t = useTranslations("objects.cell");
  const [busy, setBusy] = useState(false);
  const [error, setErrorRaw] = useState<string>();
  const errorText = useErrorText();
  // Action errors arrive as serializable items: translated here.
  const setError = (e?: unknown) => setErrorRaw(e ? errorText(e) : undefined);
  // s3 driver: direct upload to the bucket; otherwise bytes go through the web.
  const upload = async (
    list: File[],
  ): Promise<{ data?: FileValue[]; error?: ActionError | string }> => {
    const direct = await fileUploadUrls(list.map(fileInfo));
    if (direct.error) return { error: direct.error };
    if (!direct.data) {
      const form = new FormData();
      for (const f of list) form.append("files", f);
      return uploadFiles(form);
    }
    if (!(await putToBucket(direct.data, list)))
      return { error: t("uploadFailed") };
    return { data: direct.data.map((d) => d.file) };
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {files.map((f) => (
        <span
          key={f.key}
          className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-xs"
        >
          <a
            href={`/api/files/${f.key.split("/").map(encodeURIComponent).join("/")}`}
            target="_blank"
            rel="noreferrer"
            className="max-w-32 truncate hover:underline"
          >
            {f.name}
          </a>
          <button
            type="button"
            aria-label={t("removeFile", { name: f.name })}
            onClick={() => onSave(files.filter((x) => x.key !== f.key))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <label
        className="flex cursor-pointer items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:bg-muted"
        title={t("addFile")}
      >
        <Paperclip className="size-3.5" />
        {busy ? t("uploading") : files.length ? "" : t("add")}
        <input
          type="file"
          multiple
          className="sr-only"
          disabled={busy}
          onChange={async (e) => {
            const list = [...(e.target.files ?? [])];
            if (!list.length) return;
            setBusy(true);
            const res = await upload(list);
            setBusy(false);
            setError(res.error);
            if (res.data) onSave([...files, ...res.data]);
          }}
        />
      </label>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
