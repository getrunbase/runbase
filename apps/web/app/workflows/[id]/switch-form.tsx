"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import { fieldAt, parseValue, showValue, type ObjectInfo } from "../graph";
import { makeLabels } from "../labels";
import {
  caseId,
  casesFromOptions,
  TRIGGER_RECORD,
  varObject,
  type SwitchCase,
  type VarScope,
} from "../variables";
import { FieldPicker, ObjectPicker } from "./pickers";
import { Choice, opts, RecordField, type StepInput } from "./step-form-fields";

// Local alias: the name `Input` is also the input component.
type Input = StepInput;

// Switch: a record field, ordered cases (the first
// that matches wins), then Else. One branch per case on the canvas.
export function SwitchForm({
  value,
  onChange,
  objects,
  operators,
  scope,
}: {
  value: Input;
  onChange: (v: Input) => void;
  objects: ObjectInfo[];
  operators: Record<string, string[]>;
  scope: VarScope;
}) {
  const t = useTranslations("workflows");
  const l = makeLabels(t);
  const root = (value.object as string | undefined) ?? scope.root;
  const path = value.field as string | undefined;
  const field = root && path ? fieldAt(objects, root, path)?.field : undefined;
  const cases = (value.cases ?? []) as SwitchCase[];
  const ops = field ? (operators[field.type] ?? []) : [];
  const setCases = (next: SwitchCase[]) => onChange({ ...value, cases: next });
  const setCase = (i: number, c: SwitchCase) =>
    setCases(cases.map((x, j) => (j === i ? c : x)));
  const needsValue = (op: string) => op !== "is_empty" && op !== "is_not_empty";
  return (
    <div className="space-y-3">
      <RecordField
        value={value.recordId}
        scope={scope}
        onChange={(v) =>
          onChange({
            ...value,
            recordId: v,
            object: varObject(v.slice(2, -2), scope) ?? root,
            field: "",
            cases: [],
          })
        }
      />
      {!scope.root && (
        <div className="space-y-1">
          <Label>{t("stepForm.object")} *</Label>
          <ObjectPicker
            value={root}
            objects={objects}
            onChange={(slug) =>
              onChange({
                recordId: TRIGGER_RECORD,
                ...value,
                object: slug,
                field: "",
                cases: [],
              })
            }
          />
        </div>
      )}
      <div className="space-y-1">
        <Label>{t("stepForm.testedField")} *</Label>
        <div className="flex">
          <FieldPicker
            root={root}
            objects={objects}
            value={path}
            onPick={(p) =>
              onChange({
                recordId: TRIGGER_RECORD,
                ...value,
                object: root,
                field: p,
                cases: [],
              })
            }
          />
        </div>
      </div>
      {field && (
        <>
          <Label>{t("stepForm.cases")}</Label>
          {cases.map((c, i) => (
            <div key={c.id} className="space-y-2 rounded-md border p-2">
              <div className="flex gap-2">
                <Input
                  aria-label={t("stepForm.caseLabel")}
                  value={c.label}
                  onChange={(e) => setCase(i, { ...c, label: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("stepForm.removeCase")}
                  onClick={() => setCases(cases.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
              <Choice
                placeholder={t("stepForm.operator")}
                value={c.op}
                options={opts(ops, l.operator)}
                onChange={(op) =>
                  setCase(i, {
                    ...c,
                    op,
                    ...(!needsValue(op) && { value: undefined }),
                  })
                }
              />
              {needsValue(c.op) &&
                (field.type === "select" && c.op !== "in" ? (
                  <Choice
                    placeholder={t("stepForm.value")}
                    value={showValue(c.value)}
                    options={opts(field.options)}
                    onChange={(v) =>
                      setCase(i, {
                        ...c,
                        value: v,
                        label:
                          !c.label || c.label === showValue(c.value)
                            ? v
                            : c.label,
                      })
                    }
                  />
                ) : field.type === "bool" ? (
                  <Choice
                    value={showValue(c.value)}
                    options={opts(["true", "false"], l.bool)}
                    onChange={(v) => setCase(i, { ...c, value: v === "true" })}
                  />
                ) : (
                  <Input
                    key={`${c.id}:${c.op}`}
                    aria-label={t("stepForm.caseValue")}
                    placeholder={t("stepForm.value")}
                    defaultValue={showValue(c.value)}
                    onBlur={(e) =>
                      setCase(i, {
                        ...c,
                        value: parseValue(field, c.op, e.target.value),
                        label: c.label || e.target.value,
                      })
                    }
                  />
                ))}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCases([
                  ...cases,
                  {
                    id: caseId(cases, `cas ${cases.length + 1}`),
                    label: "",
                    op: ops[0] ?? "eq",
                  },
                ])
              }
            >
              <Plus /> {t("stepForm.addCase")}
            </Button>
            {field.type === "select" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCases(casesFromOptions(field.options, cases))}
              >
                {t("stepForm.onePerOption")}
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {t("stepForm.elseHelp")}
          </p>
        </>
      )}
    </div>
  );
}
