"use client";

import { SecretSelect } from "@/components/secret-select";
import {
  ConnectionSelect,
  useConnectionProvider,
} from "@/components/connection-select";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formFields, showValue, type ObjectInfo } from "../graph";
import { makeLabels } from "../labels";
import { TRIGGER_RECORD, varObject, type VarScope } from "../variables";
import { ObjectPicker, PillInput } from "./pickers";
import { AiBlockConfig, type BlockAiValue } from "./ai-config";
import { RecordFieldsForm } from "./record-fields";
import { OptionsSelect } from "./dynamic-options";
import { SheetsForm } from "./sheets-form";
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
  type,
  schema,
  value,
  onChange,
  objects,
  scope,
  options,
}: {
  // Block type: OAuth nodes get an account selector.
  type?: string;
  // Inputs with choices loaded from the connected account (dropdowns).
  options?: string[];
  schema: unknown;
  value: Input;
  onChange: (v: Input) => void;
  objects: ObjectInfo[];
  // Available variables (workflow object, previous steps).
  scope: VarScope;
}) {
  const t = useTranslations("workflows");
  const tf = useTranslations("workflows.stepForm");
  const l = makeLabels(t);
  const provider = useConnectionProvider(type);
  const set = (k: string, v: unknown) => {
    const next = { ...value, [k]: v };
    if (v === undefined || v === "") delete next[k];
    onChange(next);
  };
  const fields = formFields(schema);
  const dynamic = (k: string) => options?.includes(k) ?? false;
  // Google Sheets: file picked in Drive, tab and columns from the sheet.
  if (type?.startsWith("node.google_sheets."))
    return (
      <SheetsForm type={type} value={value} onChange={onChange} scope={scope} />
    );
  // "Update a record" / "Create a record": target object of the form.
  const target = objects.find(
    (o) =>
      o.slug ===
      (value.object ??
        varObject(String(value.recordId ?? "").slice(2, -2), scope)),
  );
  // Connector nodes: required inputs, the account and dropdowns first; the
  // other optional inputs folded under "Advanced options".
  const folded = (f: (typeof fields)[number]) =>
    !!type?.startsWith("node.") &&
    !f.required &&
    f.key !== "connection" &&
    !dynamic(f.key);
  const field = (f: (typeof fields)[number]) => (
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
              <Badge key={o.slug} asChild variant={on ? "default" : "outline"}>
                <button
                  type="button"
                  onClick={() =>
                    set(
                      "objects",
                      on ? list.filter((x) => x !== o.slug) : [...list, o.slug],
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
      {provider && f.key === "connection" && (
        <ConnectionSelect
          provider={provider}
          value={value.connection as string | undefined}
          onChange={(n) => set("connection", n)}
        />
      )}
      {f.kind === "text" && dynamic(f.key) && (
        <OptionsSelect
          type={type}
          field={f.key}
          input={value}
          deps={fields.map((x) => x.key).filter((k) => k !== f.key)}
          value={value[f.key] as string | undefined}
          onChange={(v) => set(f.key, v)}
        />
      )}
      {!(provider && f.key === "connection") &&
        !dynamic(f.key) &&
        f.key !== "object" &&
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
      {f.key === "ai" && (
        <AiBlockConfig
          value={value.ai as BlockAiValue | undefined}
          onChange={(v) => set("ai", v)}
        />
      )}
      {f.kind === "json" && f.key !== "data" && f.key !== "ai" && (
        <JsonInput
          key={JSON.stringify(value[f.key] ?? null)}
          value={value[f.key]}
          onChange={(v) => set(f.key, v)}
        />
      )}
    </div>
  );
  const advanced = fields.filter(folded);
  return (
    <div className="space-y-3">
      {fields.filter((f) => !folded(f)).map(field)}
      {advanced.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            {tf("advanced")}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            {advanced.map(field)}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
