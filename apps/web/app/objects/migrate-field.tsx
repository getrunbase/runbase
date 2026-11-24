"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { isComputed, type Field } from "@runbase/core/objects/fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@runbase/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@runbase/ui/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@runbase/ui/components/ui/input";
import { Label } from "@runbase/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useErrorText } from "@/lib/error-text";
import { makeLabels } from "../workflows/labels";
import { migrateField } from "./actions";
import { migrationSummary, type MigrationReport } from "./migrate";
import type { MigrateOp } from "@runbase/core/objects";

const TYPES: Field["type"][] = [
  "text",
  "number",
  "currency",
  "percent",
  "bool",
  "date",
  "select",
  "multi_select",
  "email",
  "phone",
  "url",
  "json",
];

// Changing a field that already has data: preview of the effect on the
// records before applying.
export function MigrateField({
  objectId,
  fields,
}: {
  objectId: string;
  fields: Field[];
}) {
  const router = useRouter();
  const t = useTranslations("objects.migrate");
  const { fieldType: fieldTypeLabel } = makeLabels(
    useTranslations("workflows"),
  );
  const editable = fields.filter((f) => !isComputed(f));
  const [field, setField] = useState(editable[0]?.key ?? "");
  const [kind, setKind] = useState<"rename" | "change_type">("change_type");
  const [to, setTo] = useState("");
  const [type, setType] = useState<Field["type"]>("text");
  const [options, setOptions] = useState("");
  const [dropInvalid, setDropInvalid] = useState(false);
  const [report, setReport] = useState<MigrationReport>();
  const errorText = useErrorText();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (!editable.length) return null;

  const op = (): MigrateOp =>
    kind === "rename"
      ? { op: "rename", field, to: to.trim() }
      : {
          op: "change_type",
          field,
          type,
          dropInvalid,
          ...(type === "select" || type === "multi_select"
            ? {
                options: options
                  .split(",")
                  .map((o) => o.trim())
                  .filter(Boolean),
              }
            : {}),
        };
  const reset = () => {
    setReport(undefined);
    setError(undefined);
    setDone(false);
  };
  const runOp = (dryRun: boolean) =>
    start(async () => {
      const r = await migrateField(objectId, op(), dryRun);
      setError(r.error && errorText(r.error));
      setReport(r.report);
      if (!dryRun && !r.error) {
        setDone(true);
        router.refresh();
      }
    });

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("field")}</Label>
            <Select
              value={field}
              onValueChange={(v) => {
                setField(v);
                reset();
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {editable.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label} ({fieldTypeLabel(f.type)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("change")}</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as typeof kind);
                reset();
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="change_type">{t("changeType")}</SelectItem>
                <SelectItem value="rename">{t("rename")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {kind === "rename" ? (
          <div className="space-y-2">
            <Label htmlFor="mig-to">{t("newKey")}</Label>
            <Input
              id="mig-to"
              value={to}
              placeholder={t("newKeyPlaceholder")}
              onChange={(e) => {
                setTo(e.target.value);
                reset();
              }}
            />
            <p className="text-muted-foreground text-sm">{t("renameHint")}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("newType")}</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v as Field["type"]);
                  reset();
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((ft) => (
                    <SelectItem key={ft} value={ft}>
                      {fieldTypeLabel(ft)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(type === "select" || type === "multi_select") && (
              <div className="space-y-2">
                <Label htmlFor="mig-options">{t("options")}</Label>
                <Input
                  id="mig-options"
                  value={options}
                  onChange={(e) => {
                    setOptions(e.target.value);
                    reset();
                  }}
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={dropInvalid}
                onCheckedChange={(v) => {
                  setDropInvalid(v === true);
                  reset();
                }}
              />
              {t("dropInvalid")}
            </label>
          </div>
        )}
        {report && (
          <Alert
            variant={report.invalid && !dropInvalid ? "destructive" : "default"}
          >
            <AlertDescription className="space-y-1">
              <p>
                {done ? `${t("applied")} ` : ""}
                {migrationSummary(report, (k, v) => t(`summary.${k}`, v))}
              </p>
              {report.samples.length > 0 && (
                <ul className="list-disc pl-4 text-xs">
                  {report.samples.slice(0, 5).map((s) => (
                    <li key={s.id}>
                      {t("sample", { value: String(s.value), error: s.error })}
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending || (kind === "rename" && !to.trim())}
            onClick={() => runOp(true)}
          >
            {t("preview")}
          </Button>
          <Button
            type="button"
            disabled={pending || !report || done}
            onClick={() => runOp(false)}
          >
            {t("apply")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
