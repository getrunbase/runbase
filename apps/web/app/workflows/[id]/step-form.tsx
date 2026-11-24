"use client";

import { SecretSelect } from "@/components/secret-select";
import { useTranslations } from "next-intl";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formFields, showValue, type ObjectInfo } from "../graph";
import { makeLabels } from "../labels";
import { TRIGGER_RECORD, varObject, type VarScope } from "../variables";
import { ObjectPicker, PillInput } from "./pickers";
import { RecordFieldsForm } from "./record-fields";
import {
  Choice,
  InsertSecret,
  JsonInput,
  opts,
  RecordField,
  type StepInput,
} from "./step-form-fields";

// The other step forms live in sibling files; re-exported to keep imports stable.
export { ConditionForm } from "./condition-form";
export { ListForm } from "./list-form";
export { MapForm } from "./map-form";
export { SwitchForm } from "./switch-form";

// Local alias: the name `Input` is also the input component.
type Input = StepInput;

// Config panel generated from the block's inputSchema (JSON Schema).
export function SchemaForm({
  schema,
  value,
  onChange,
  objects,
  scope,
}: {
  schema: unknown;
  value: Input;
  onChange: (v: Input) => void;
  objects: ObjectInfo[];
  // Available variables (workflow object, previous steps).
  scope: VarScope;
}) {
  const t = useTranslations("workflows");
  const l = makeLabels(t);
  const set = (k: string, v: unknown) => {
    const next = { ...value, [k]: v };
    if (v === undefined || v === "") delete next[k];
    onChange(next);
  };
  // "Update a record" / "Create a record": target object of the form.
  const target = objects.find(
    (o) =>
      o.slug ===
      (value.object ??
        varObject(String(value.recordId ?? "").slice(2, -2), scope)),
  );
  return (
    <div className="space-y-3">
      {formFields(schema).map((f) => (
        <div key={f.key} className="space-y-1">
          {f.key === "recordId" || f.key === "id" ? (
            <RecordField
              value={value[f.key]}
              scope={scope}
              onChange={(v) => set(f.key, v)}
            />
          ) : (
            <Label>
              {l.input(f.key)}
              {f.required && " *"}
            </Label>
          )}
          {f.key === "object" ? (
            <ObjectPicker
              value={value.object as string}
              objects={objects}
              onChange={(slug) => set("object", slug)}
            />
          ) : f.key === "objects" ? (
            <div className="flex flex-wrap gap-1">
              {objects.map((o) => {
                const list = (value.objects as string[] | undefined) ?? [];
                const on = list.includes(o.slug);
                return (
                  <Badge
                    key={o.slug}
                    asChild
                    variant={on ? "default" : "outline"}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        set(
                          "objects",
                          on
                            ? list.filter((x) => x !== o.slug)
                            : [...list, o.slug],
                        )
                      }
                    >
                      {o.name}
                    </button>
                  </Badge>
                );
              })}
            </div>
          ) : null}
          {f.key !== "object" &&
            f.key !== "objects" &&
            f.key !== "recordId" &&
            f.key !== "id" &&
            f.key !== "secret" &&
            f.kind === "text" && (
              <>
                <PillInput
                  ariaLabel={l.input(f.key)}
                  scope={scope}
                  value={String(value[f.key] ?? "")}
                  onChange={(v) => set(f.key, v)}
                />
                <InsertSecret
                  onPick={(n) =>
                    set(f.key, `${String(value[f.key] ?? "")}{{secret.${n}}}`)
                  }
                />
              </>
            )}
          {f.key === "secret" && f.kind === "text" && (
            <SecretSelect
              value={String(value.secret ?? "")}
              onChange={(n) => set("secret", n)}
            />
          )}
          {f.kind === "number" && (
            <Input
              type="number"
              step="any"
              value={String(value[f.key] ?? "")}
              onChange={(e) =>
                set(
                  f.key,
                  e.target.value === "" ? undefined : Number(e.target.value),
                )
              }
            />
          )}
          {f.kind === "bool" && (
            <Switch
              checked={value[f.key] === true}
              onCheckedChange={(c) => set(f.key, c)}
            />
          )}
          {f.kind === "enum" && (
            <Choice
              value={value[f.key] as string}
              options={opts(f.options!)}
              onChange={(v) => set(f.key, v)}
            />
          )}
          {f.key === "include" && (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1">
                {(
                  objects.find(
                    (o) =>
                      o.slug ===
                      varObject(
                        String(value.id ?? TRIGGER_RECORD).slice(2, -2),
                        scope,
                      ),
                  )?.fields ?? []
                )
                  .filter((x) => x.type === "ref" || x.type === "refs")
                  .map((x) => {
                    const list = (value.include as string[] | undefined) ?? [];
                    const on = list.includes(x.key);
                    return (
                      <Badge
                        key={x.key}
                        asChild
                        variant={on ? "default" : "outline"}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            set(
                              "include",
                              on
                                ? list.filter((k) => k !== x.key)
                                : [...list, x.key],
                            )
                          }
                        >
                          {x.label}
                        </button>
                      </Badge>
                    );
                  })}
              </div>
              <p className="text-muted-foreground text-xs">
                {t("stepForm.includeHelp")}
              </p>
            </div>
          )}
          {f.key !== "objects" && f.key !== "include" && f.kind === "list" && (
            <Input
              placeholder={t("stepForm.listPlaceholder")}
              defaultValue={showValue(value[f.key])}
              onBlur={(e) =>
                set(
                  f.key,
                  e.target.value
                    ? e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : undefined,
                )
              }
            />
          )}
          {f.kind === "json" && f.key === "data" && (
            <RecordFieldsForm
              object={target}
              value={(value.data ?? {}) as Input}
              scope={scope}
              onChange={(d) => onChange({ ...value, data: d })}
            />
          )}
          {f.kind === "json" && f.key !== "data" && (
            <JsonInput
              key={JSON.stringify(value[f.key] ?? null)}
              value={value[f.key]}
              onChange={(v) => set(f.key, v)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
