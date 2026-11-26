"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Play, Trash2, X } from "lucide-react";
import { useErrorText } from "@/lib/error-text";
import { testStepAction } from "../actions";
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
import { cn } from "cn";
import { kindOf } from "./kind";
import { BlockIcon } from "./block-picker";
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
  const errorText = useErrorText();
  const kind = kindOf(step.type, t, block);
  type Result = Awaited<ReturnType<typeof testStepAction>>;
  const [test, setTest] = useState<Result | "running" | null>(null);
  const run = async (live: boolean) => {
    setTest("running");
    setTest(await testStepAction(def, step.id, live));
  };
  return (
    <div key={step.id} className="-mx-5 -my-4.5 flex flex-1 flex-col">
      {/* Header (design StepCanvas): app logo or category icon, action, app. */}
      <div className="bg-background sticky top-0 z-10 flex items-center gap-3 border-b px-5 py-4">
        <BlockIcon type={step.type} logo={kind.logo} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            className="truncate text-base font-semibold"
            title={block?.description}
          >
            {block?.label ?? step.type}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {kind.kindLabel}
          </span>
        </div>
        <button
          type="button"
          aria-label={tc("close")}
          onClick={() => setSelected(null)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4.5 px-5 py-4.5">
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
            options={block?.options}
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
                          {targetsAt(def, step.id, b)
                            .map(stepLabel)
                            .join(", ") || t("editor.unlinked")}
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
      </div>
      {/* Footer: test the step, delete it. */}
      <div className="bg-background sticky bottom-0 flex flex-col gap-3 border-t px-5 py-3.5">
        {test && test !== "running" && (
          <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto text-xs">
            {test.error ? (
              <p role="alert" className="text-destructive">
                {errorText(test.error)}
              </p>
            ) : (
              <>
                <p className="font-medium">
                  {t("editor.testResult")}
                  {test.data?.branch &&
                    test.data.branch !== "ok" &&
                    ` · ${t("editor.testBranch", { branch: test.data.branch })}`}
                </p>
                {test.data?.simulated ? (
                  <p className="text-muted-foreground">
                    {t("editor.testSimulated")}
                  </p>
                ) : (
                  <pre className="bg-muted rounded-md p-2 font-mono whitespace-pre-wrap">
                    {JSON.stringify(test.data?.output ?? null, null, 2)}
                  </pre>
                )}
              </>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={test === "running"}
            onClick={() => run(false)}
          >
            <Play />
            {test === "running" ? t("editor.testing") : t("editor.testStep")}
          </Button>
          {test && test !== "running" && test.data?.simulated && (
            <Button variant="outline" onClick={() => run(true)}>
              {t("editor.testStepLive")}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={t("editor.deleteStep")}
            className="text-destructive hover:text-destructive"
            onClick={() => {
              setDef(removeStep(def, step.id));
              setSelected(null);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
}
