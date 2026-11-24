"use client";

import { KeyRound } from "lucide-react";
import { useSecretNames } from "@/components/secret-select";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@runbase/ui/components/ui/button";
import { Label } from "@runbase/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { rootName, TRIGGER_RECORD, type VarScope } from "../variables";
import { PillInput } from "./pickers";

// Shared building blocks of the step config forms.
export type StepInput = Record<string, unknown>;

// Mapping expression: a field / relation path, or a constant / template.
export type Expr = { path: string } | { value: unknown };

export function Choice({
  value,
  options,
  onChange,
  placeholder,
}: {
  value?: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Inserts a `{{secret.NAME}}` reference: resolved on the server at
// run time, the value never reaches the editor.
export function InsertSecret({ onPick }: { onPick: (name: string) => void }) {
  const t = useTranslations("common.secretPicker");
  const names = useSecretNames();
  if (!names.length) return null;
  return (
    <Select value="" onValueChange={onPick}>
      <SelectTrigger size="sm" className="text-muted-foreground h-7 w-auto">
        <KeyRound />
        <SelectValue placeholder={t("insert")} />
      </SelectTrigger>
      <SelectContent>
        {names.map((n) => (
          <SelectItem key={n} value={n} className="font-mono">
            {n}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const opts = (xs: string[], label = (x: string) => x) =>
  xs.map((x) => ({ value: x, label: label(x) }));

// "Record" field: the triggering record by default, otherwise a variable
// (linked record or record of a previous step).
export function RecordField({
  value,
  onChange,
  scope,
  label: labelProp,
}: {
  value: unknown;
  onChange: (v: string) => void;
  scope: VarScope;
  label?: string;
}) {
  const t = useTranslations("workflows");
  const label = labelProp ?? t("stepForm.record");
  const current = String(value ?? TRIGGER_RECORD);
  const [open, setOpen] = useState(current !== TRIGGER_RECORD);
  // Common case: the step acts on the workflow record, we say so plainly
  // and hide the selector (linked record, step record) behind "Change".
  if (scope.root && !open)
    return (
      <p className="text-muted-foreground text-sm">
        {t("stepForm.appliesTo")}{" "}
        <span className="text-foreground font-medium">{rootName(scope)}</span>{" "}
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={() => setOpen(true)}
        >
          {t("stepForm.change")}
        </Button>
      </p>
    );
  return (
    <div className="space-y-1">
      <Label>{label} *</Label>
      <PillInput
        ariaLabel={label}
        single
        records
        scope={scope}
        value={String(value ?? TRIGGER_RECORD)}
        onChange={onChange}
        placeholder={t("stepForm.recordPlaceholder")}
      />
    </div>
  );
}

// Free JSON value; non-JSON text (e.g. a `{{…}}` template) kept as is.
export function JsonInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <Textarea
      className="font-mono text-xs"
      defaultValue={
        value === undefined
          ? ""
          : typeof value === "string"
            ? value
            : JSON.stringify(value)
      }
      onBlur={(e) => {
        const raw = e.target.value;
        if (!raw) return onChange(undefined);
        try {
          onChange(JSON.parse(raw));
        } catch {
          onChange(raw);
        }
      }}
    />
  );
}
