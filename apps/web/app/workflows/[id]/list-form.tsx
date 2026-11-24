"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import { showValue, type ObjectInfo } from "../graph";
import { type VarScope } from "../variables";
import { condRows, ConditionRows } from "./condition-form";
import { FieldPicker } from "./pickers";
import { Choice, type Expr, type StepInput } from "./step-form-fields";

// Local alias: the name `Input` is also the input component.
type Input = StepInput;

// List blocks: source list chosen among the record lists
// produced upstream, then condition (filter) or columns (transformation).
export function ListForm({
  type,
  value,
  onChange,
  objects,
  operators,
  scope,
}: {
  type: "list.filter" | "list.map";
  value: Input;
  onChange: (v: Input) => void;
  objects: ObjectInfo[];
  operators: Record<string, string[]>;
  scope: VarScope;
}) {
  const t = useTranslations("workflows");
  const lists = scope.lists ?? [];
  const root = value.object as string | undefined;
  const mapping = (value.mapping ?? {}) as Record<string, Expr>;
  const cols = Object.entries(mapping);
  const setCols = (next: [string, Expr][]) =>
    onChange({ ...value, mapping: Object.fromEntries(next) });
  const rows = condRows(value.condition);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t("stepForm.list")} *</Label>
        {lists.length ? (
          <Choice
            placeholder={t("stepForm.chooseList")}
            value={value.items as string}
            options={lists.map((l) => ({
              value: l.path,
              label: `${l.label} (${objects.find((o) => o.slug === l.object)?.name ?? l.object})`,
            }))}
            onChange={(path) =>
              onChange({
                ...value,
                items: path,
                object: lists.find((l) => l.path === path)!.object,
                ...(type === "list.filter"
                  ? { condition: { all: [] } }
                  : { mapping: {} }),
              })
            }
          />
        ) : (
          <p className="text-muted-foreground text-xs">
            {t("stepForm.noList")}
          </p>
        )}
      </div>
      {root && type === "list.filter" && (
        <>
          <Label>{t("stepForm.keepWhere")}</Label>
          <ConditionRows
            root={root}
            rows={rows}
            setRows={(all) => onChange({ ...value, condition: { all } })}
            objects={objects}
            operators={operators}
          />
        </>
      )}
      {root && type === "list.map" && (
        <>
          <Label>{t("stepForm.columns")}</Label>
          <p className="text-muted-foreground text-xs">
            {t("stepForm.columnsHelp")}
          </p>
          {cols.map(([k, e], i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label={t("stepForm.columnName")}
                className="w-32"
                defaultValue={k}
                onBlur={(ev) =>
                  setCols(
                    cols.map((c, j) =>
                      j === i ? [ev.target.value.trim() || k, c[1]] : c,
                    ),
                  )
                }
              />
              {"path" in e || !("value" in e) ? (
                <FieldPicker
                  root={root}
                  objects={objects}
                  value={"path" in e ? e.path : undefined}
                  onPick={(path) =>
                    setCols(
                      cols.map((c, j) => (j === i ? [c[0], { path }] : c)),
                    )
                  }
                />
              ) : (
                <Input disabled value={showValue(e.value)} />
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("stepForm.removeColumn")}
                onClick={() => setCols(cols.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              let n = cols.length + 1;
              while (t("stepForm.columnDefault", { n }) in mapping) n++;
              setCols([
                ...cols,
                [t("stepForm.columnDefault", { n }), { path: "" }],
              ]);
            }}
          >
            <Plus /> {t("stepForm.addColumn")}
          </Button>
        </>
      )}
      <div className="space-y-1">
        <Label>{t("stepForm.limit")}</Label>
        <Input
          type="number"
          min={1}
          placeholder="100"
          value={String(value.limit ?? "")}
          onChange={(e) => {
            const next = { ...value };
            if (e.target.value === "") delete next.limit;
            else next.limit = Number(e.target.value);
            onChange(next);
          }}
        />
        <p className="text-muted-foreground text-xs">
          {t("stepForm.limitHelp")}
        </p>
      </div>
    </div>
  );
}
