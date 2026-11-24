"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@runbase/ui/components/ui/button";
import { Input } from "@runbase/ui/components/ui/input";
import { Label } from "@runbase/ui/components/ui/label";
import { fieldAt, parseValue, showValue, type ObjectInfo } from "../graph";
import { makeLabels } from "../labels";
import { TRIGGER_RECORD, varObject, type VarScope } from "../variables";
import { FieldPicker, ObjectPicker } from "./pickers";
import { Choice, opts, RecordField, type StepInput } from "./step-form-fields";

// Local alias: the name `Input` is also the input component.
type Input = StepInput;

export type Cond = { field: string; op: string; value?: unknown };

// Condition rows: `{ all: [...] }` (editor format) or a single
// rule `{ field, op, value }` (written by the MCP / the AI), read as one row.
// ponytail: `any` and nested groups not editable here, rendered empty.
export const condRows = (c: unknown): Cond[] => {
  const x = c as { all?: Cond[]; field?: string } | undefined;
  return x?.all ?? (x?.field ? [x as Cond] : []);
};

// Typed condition builder: fields of the object and its relations
// (`a.b.c` paths), operators filtered by type.
export function ConditionForm({
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
  const root = value.object as string | undefined;
  const rows = condRows(value.condition);
  const setRows = (all: Cond[]) => onChange({ ...value, condition: { all } });
  return (
    <div className="space-y-3">
      <RecordField
        value={value.recordId}
        scope={scope}
        onChange={(v) =>
          onChange({
            ...value,
            recordId: v,
            // The object follows the chosen record (linked record, step record).
            object: varObject(v.slice(2, -2), scope) ?? value.object,
          })
        }
      />
      {!scope.root && (
        <div className="space-y-1">
          <Label>{t("stepForm.object")} *</Label>
          <ObjectPicker
            value={value.object as string}
            objects={objects}
            onChange={(slug) =>
              onChange({
                recordId: TRIGGER_RECORD,
                ...value,
                object: slug,
                condition: { all: [] },
              })
            }
          />
        </div>
      )}
      <Label>{t("stepForm.conditionTitle")}</Label>
      <ConditionRows
        root={root}
        rows={rows}
        setRows={setRows}
        objects={objects}
        operators={operators}
      />
    </div>
  );
}

// "field / operator / value" rows (all must be true).
export function ConditionRows({
  root,
  rows,
  setRows,
  objects,
  operators,
}: {
  root?: string;
  rows: Cond[];
  setRows: (r: Cond[]) => void;
  objects: ObjectInfo[];
  operators: Record<string, string[]>;
}) {
  const t = useTranslations("workflows");
  const l = makeLabels(t);
  const object = objects.find((o) => o.slug === root);
  const setRow = (i: number, r: Cond) =>
    setRows(rows.map((x, j) => (j === i ? r : x)));
  return (
    <>
      {rows.map((r, i) => {
        const field =
          root && r.field ? fieldAt(objects, root, r.field)?.field : undefined;
        const ops = field ? (operators[field.type] ?? []) : [];
        const needsValue =
          r.op && r.op !== "is_empty" && r.op !== "is_not_empty";
        const update = (raw: string) =>
          field && setRow(i, { ...r, value: parseValue(field, r.op, raw) });
        return (
          <div key={i} className="space-y-2 rounded-md border p-2">
            <div className="flex gap-2">
              <FieldPicker
                root={root}
                objects={objects}
                value={r.field}
                onPick={(path) => setRow(i, { field: path, op: "" })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("stepForm.removeCondition")}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
            {field && (
              <Choice
                placeholder={t("stepForm.operator")}
                value={r.op}
                options={opts(ops, l.operator)}
                onChange={(op) => setRow(i, { field: r.field, op })}
              />
            )}
            {field &&
              needsValue &&
              (field.type === "bool" ? (
                <Choice
                  value={showValue(r.value)}
                  options={opts(["true", "false"], l.bool)}
                  onChange={update}
                />
              ) : field.type === "select" && r.op !== "in" ? (
                <Choice
                  value={showValue(r.value)}
                  options={opts(field.options)}
                  onChange={update}
                />
              ) : (
                <Input
                  key={`${r.field}:${r.op}`}
                  type={
                    field.type === "number" &&
                    r.op !== "in" &&
                    r.op !== "between"
                      ? "number"
                      : "text"
                  }
                  placeholder={
                    r.op === "in" || r.op === "between"
                      ? "a, b"
                      : r.op === "older_than" || r.op === "within"
                        ? t("stepForm.days")
                        : t("stepForm.value")
                  }
                  defaultValue={showValue(r.value)}
                  onBlur={(e) => update(e.target.value)}
                />
              ))}
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        disabled={!object}
        onClick={() => setRows([...rows, { field: "", op: "" }])}
      >
        <Plus /> {t("stepForm.addCondition")}
      </Button>
    </>
  );
}
