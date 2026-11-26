"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, Trash2, X } from "lucide-react";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  branchesOf,
  branchName,
  removeStep,
  setTargets,
  targetsAt,
  type BlockInfo,
  type Definition,
  type ObjectInfo,
} from "../graph";
import type { scopeFor } from "../variables";
import { makeLabels } from "../labels";
import { IconTile } from "@/components/ds/atoms";
import { flowKind } from "@/components/ds/flow";
import { cn } from "cn";
import { kindOf } from "./kind";
import {
  ConditionForm,
  ListForm,
  MapForm,
  SchemaForm,
  SwitchForm,
} from "./step-form";

// Config panel of the selected step: input form, output links, deletion.
export function StepPanel({
  step,
  block,
  def,
  setDef,
  objects,
  operators,
  scope,
  updateInput,
  stepLabel,
  setSelected,
}: {
  step: Definition["steps"][number];
  block: BlockInfo | undefined;
  def: Definition;
  setDef: (d: Definition) => void;
  objects: ObjectInfo[];
  operators: Record<string, string[]>;
  scope: ReturnType<typeof scopeFor>;
  updateInput: (id: string, input: Record<string, unknown>) => void;
  stepLabel: (id: string) => string;
  setSelected: (id: string | null) => void;
}) {
  const t = useTranslations("workflows");
  const tc = useTranslations("common");
  const l = makeLabels(t);
  return (
    <div key={step.id} className="flex flex-1 flex-col gap-4.5">
      <div className="flex items-center gap-2">
        <IconTile
          icon={kindOf(step.type, t).icon}
          tone={flowKind[kindOf(step.type, t).kind].tone}
          size="panel"
        />
        <span className="text-muted-foreground flex-1 truncate text-xs font-medium">
          {block?.label ?? step.type}
        </span>
        <button
          type="button"
          aria-label={tc("close")}
          onClick={() => setSelected(null)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      {block?.description && (
        <p className="text-muted-foreground text-xs">{block.description}</p>
      )}
      {step.type === "condition" ? (
        <ConditionForm
          value={step.input ?? {}}
          onChange={(i) => updateInput(step.id, i)}
          objects={objects}
          operators={operators}
          scope={scope}
        />
      ) : step.type === "switch" ? (
        <SwitchForm
          value={step.input ?? {}}
          onChange={(i) => updateInput(step.id, i)}
          objects={objects}
          operators={operators}
          scope={scope}
        />
      ) : step.type === "list.filter" || step.type === "list.map" ? (
        <ListForm
          type={step.type}
          value={step.input ?? {}}
          onChange={(i) => updateInput(step.id, i)}
          objects={objects}
          operators={operators}
          scope={scope}
        />
      ) : step.type === "record.map" ? (
        <MapForm
          value={step.input ?? {}}
          onChange={(i) => updateInput(step.id, i)}
          objects={objects}
          scope={scope}
        />
      ) : (
        <SchemaForm
          type={step.type}
          schema={block?.inputSchema}
          value={step.input ?? {}}
          onChange={(i) => updateInput(step.id, i)}
          objects={objects}
          scope={scope}
        />
      )}
      {/* Liens au clic, en plus du glisser depuis les poignées. */}
      {branchesOf(step, block).length > 0 && (
        <>
          <div className="bg-border h-px w-full" />
          <p className="text-sm font-semibold">{t("editor.outputs")}</p>
          <div className="flex flex-col gap-2">
            {branchesOf(step, block).map((b) => (
              <div key={b} className="flex items-center gap-2">
                <span className="text-muted-foreground max-w-24 shrink-0 truncate rounded-sm border px-1.5 py-px text-tiny font-medium">
                  {branchName(step, b, l.branch)}
                </span>
                <ArrowRight className="text-subtle-foreground size-3 shrink-0" />
                {/* Plusieurs cibles cochées = étapes en parallèle. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-sm",
                        targetsAt(def, step.id, b).length
                          ? "font-medium"
                          : "text-destructive",
                      )}
                      aria-label={t("editor.nextStepFor", {
                        branch: branchName(step, b, l.branch),
                      })}
                    >
                      <span className="truncate">
                        {targetsAt(def, step.id, b).map(stepLabel).join(", ") ||
                          t("editor.unlinked")}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {def.steps
                      .filter((o) => o.id !== step.id)
                      .map((o) => {
                        const cur = targetsAt(def, step.id, b);
                        return (
                          <DropdownMenuCheckboxItem
                            key={o.id}
                            checked={cur.includes(o.id)}
                            onSelect={(e) => e.preventDefault()}
                            onCheckedChange={(on) =>
                              setDef(
                                setTargets(
                                  def,
                                  step.id,
                                  b,
                                  on
                                    ? [...cur, o.id]
                                    : cur.filter((x) => x !== o.id),
                                ),
                              )
                            }
                          >
                            {stepLabel(o.id)} · {o.id}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="flex-1" />
      <Button
        variant="ghost"
        className="text-destructive hover:text-destructive w-fit"
        onClick={() => {
          setDef(removeStep(def, step.id));
          setSelected(null);
        }}
      >
        <Trash2 />
        {t("editor.deleteStep")}
      </Button>
    </div>
  );
}
