"use client";

import { useTranslations } from "next-intl";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import { type ObjectInfo } from "../graph";
import {
  dataToMapping,
  mappingToData,
  TRIGGER_RECORD,
  varObject,
  type VarScope,
} from "../variables";
import { ObjectPicker } from "./pickers";
import { RecordFieldsForm } from "./record-fields";
import {
  Choice,
  RecordField,
  type Expr,
  type StepInput,
} from "./step-form-fields";

// Local alias: the name `Input` is also the input component.
type Input = StepInput;

// record.map editor: source and target object (all databases),
// mode, then two columns target field ← value (field / relation path
// of the source, or constant / template).
export function MapForm({
  value,
  onChange,
  objects,
  scope,
}: {
  value: Input;
  onChange: (v: Input) => void;
  objects: ObjectInfo[];
  scope: VarScope;
}) {
  const t = useTranslations("workflows");
  const record = scope.root;
  const set = (k: string, v: unknown) => {
    const next = { ...value, [k]: v };
    if (v === undefined || v === "") delete next[k];
    onChange(next);
  };
  const source = (value.sourceObject as string | undefined) ?? record;
  const target = objects.find((o) => o.slug === value.object);
  const mapping = (value.mapping ?? {}) as Record<string, Expr>;
  const mode = (value.mode as string | undefined) ?? "create";
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t("stepForm.sourceObject")}</Label>
        <ObjectPicker
          value={source}
          objects={objects}
          onChange={(slug) =>
            onChange({
              source: TRIGGER_RECORD,
              ...value,
              sourceObject: slug,
            })
          }
        />
      </div>
      <RecordField
        label={t("stepForm.sourceRecord")}
        value={value.source}
        scope={scope}
        onChange={(v) =>
          onChange({
            ...value,
            source: v,
            sourceObject: varObject(v.slice(2, -2), scope) ?? source,
          })
        }
      />
      <div className="space-y-1">
        <Label>{t("stepForm.targetObject")} *</Label>
        <ObjectPicker
          value={value.object as string}
          objects={objects}
          onChange={(slug) =>
            onChange({
              source: TRIGGER_RECORD,
              sourceObject: source,
              ...value,
              object: slug,
              mapping: {},
            })
          }
        />
      </div>
      <div className="space-y-1">
        <Label>{t("stepForm.mode")}</Label>
        <Choice
          value={mode}
          options={[
            { value: "create", label: t("stepForm.modes.create") },
            { value: "update", label: t("stepForm.modes.update") },
            { value: "upsert", label: t("stepForm.modes.upsert") },
          ]}
          onChange={(v) => set("mode", v)}
        />
      </div>
      {mode === "update" && (
        <RecordField
          label={t("stepForm.targetRecord")}
          value={value.recordId ?? ""}
          scope={scope}
          onChange={(v) => set("recordId", v)}
        />
      )}
      {mode === "upsert" && (
        <div className="space-y-1">
          <Label>{t("stepForm.matchKey")} *</Label>
          <Choice
            value={value.key as string}
            options={[
              { value: "external_id", label: t("stepForm.externalId") },
              ...(target?.fields ?? []).map((f) => ({
                value: f.key,
                label: f.label,
              })),
            ]}
            onChange={(v) => set("key", v)}
          />
          {value.key === "external_id" && (
            <Input
              placeholder={t("stepForm.externalIdPlaceholder")}
              value={String(value.externalId ?? "")}
              onChange={(e) => set("externalId", e.target.value)}
            />
          )}
        </div>
      )}
      {target && (
        <div className="space-y-1">
          <Label>{t("stepForm.targetFields")}</Label>
          <RecordFieldsForm
            object={target}
            value={mappingToData(mapping)}
            scope={{ ...scope, source }}
            onChange={(d) =>
              set("mapping", dataToMapping(d) as Record<string, Expr>)
            }
          />
        </div>
      )}
    </div>
  );
}
