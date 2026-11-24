"use client";

// Field-by-field record form: "Update a record",
// "Create a record" and the record.map mapping. Generated from the schema
// of the target object; each value is typed (select, checkbox, date…)
// or a variable pill.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import type { Field } from "@getrunbase/core/objects/fields";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@getrunbase/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ObjectInfo } from "../graph";
import { makeLabels } from "../labels";
import {
  constantValue,
  fieldDefault,
  isTemplate,
  setField,
  type VarScope,
} from "../variables";
import { FIELD_ICONS, PillInput, VariableMenu } from "./pickers";

type Data = Record<string, unknown>;

// Field value: typed control, or variable pill.
function FieldValue({
  field,
  value,
  onChange,
  scope,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  scope: VarScope;
}) {
  const t = useTranslations("workflows");
  const asVar = (path: string) => onChange(`{{${path}}}`);
  const pills =
    isTemplate(value) ||
    ["text", "email", "url", "json", "ref", "refs", "multi_select"].includes(
      field.type,
    );
  if (pills)
    return (
      <PillInput
        ariaLabel={field.label}
        value={
          value === undefined
            ? ""
            : typeof value === "string"
              ? value
              : Array.isArray(value)
                ? value.join(", ")
                : String(value)
        }
        records={field.type === "ref" || field.type === "refs"}
        single={field.type === "ref"}
        scope={scope}
        placeholder={
          field.type === "ref" || field.type === "refs"
            ? t("stepForm.recordPlaceholder")
            : undefined
        }
        onChange={(v) => onChange(constantValue(field, v) ?? "")}
      />
    );
  return (
    <div className="flex items-center gap-1">
      {field.type === "select" ? (
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger className="w-full" aria-label={field.label}>
            <SelectValue placeholder={t("recordFields.choose")} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "bool" ? (
        <Checkbox
          aria-label={field.label}
          checked={value === true}
          onCheckedChange={(c) => onChange(c === true)}
        />
      ) : (
        <Input
          aria-label={field.label}
          type={field.type === "date" ? "date" : "number"}
          step="any"
          value={String(value ?? "")}
          onChange={(e) => onChange(constantValue(field, e.target.value) ?? "")}
        />
      )}
      <VariableMenu scope={scope} onPick={asVar} />
    </div>
  );
}

export function RecordFieldsForm({
  object,
  value,
  onChange,
  scope,
}: {
  object?: ObjectInfo;
  value: Data;
  onChange: (v: Data) => void;
  scope: VarScope;
}) {
  const t = useTranslations("workflows");
  const l = makeLabels(t);
  const [open, setOpen] = useState(false);
  if (!object)
    return (
      <p className="text-muted-foreground text-xs">
        {t("recordFields.chooseFirst")}
      </p>
    );
  const rows = object.fields.filter((f) => f.key in value);
  const free = object.fields.filter((f) => !(f.key in value));
  return (
    <div className="space-y-2">
      {rows.map((f) => {
        const Icon = FIELD_ICONS[f.type];
        return (
          <div key={f.key} className="space-y-1 rounded-md border p-2">
            <div className="flex items-center gap-1 text-sm">
              <Icon className="text-muted-foreground size-3.5" />
              <span className="flex-1 truncate font-medium">{f.label}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={t("editor.removeItem", { label: f.label })}
                onClick={() => onChange(setField(value, f.key, undefined))}
              >
                <Trash2 />
              </Button>
            </div>
            <FieldValue
              field={f}
              value={value[f.key]}
              scope={scope}
              onChange={(v) => onChange(setField(value, f.key, v))}
            />
          </div>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={!free.length}>
            <Plus /> {t("recordFields.addField")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder={t("pickers.searchField")} />
            <CommandList>
              <CommandEmpty>{t("pickers.noField")}</CommandEmpty>
              <CommandGroup heading={object.name}>
                {free.map((f) => {
                  const Icon = FIELD_ICONS[f.type];
                  return (
                    <CommandItem
                      key={f.key}
                      value={f.label}
                      onSelect={() => {
                        onChange(setField(value, f.key, fieldDefault(f)));
                        setOpen(false);
                      }}
                    >
                      <Icon className="text-muted-foreground" />
                      {f.label}
                      <span className="text-muted-foreground ml-auto text-xs">
                        {l.fieldType(f.type)}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
