"use client";

import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@getrunbase/ui/components/ui/card";
import { branchName, showValue, type Definition } from "../graph";
import { makeLabels, type Labels } from "../labels";
import type { ActionError } from "@/lib/action-error";
import { useErrorText } from "@/lib/error-text";
import type { dryRunWorkflow } from "../actions";
import type { Link } from "./record-search";

// Translated engine error or reason; technical branch name -> label.
const engineText = (
  item: ActionError,
  errorText: (e: unknown) => string,
  l: Labels,
) =>
  errorText(
    "branch" in item.params
      ? {
          ...item,
          params: {
            ...item.params,
            branch: l.branch(String(item.params.branch)),
          },
        }
      : item,
  );

export type DryRun = Awaited<ReturnType<typeof dryRunWorkflow>>;

// Validation errors and dry-run results shown under the config panel.
export function RunResults({
  errors,
  dry,
  testRecords,
  def,
  stepLabel,
}: {
  errors: ActionError[] | null;
  dry: DryRun | null;
  testRecords: Link[];
  def: Definition;
  stepLabel: (id: string) => string;
}) {
  const t = useTranslations("workflows");
  const l = makeLabels(t);
  const errorText = useErrorText();
  return (
    <>
      {errors && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {errors.length ? t("editor.errors") : t("editor.valid")}
            </CardTitle>
          </CardHeader>
          {errors.length > 0 && (
            <CardContent className="text-destructive space-y-1 text-xs">
              {errors.map((e, i) => (
                <p key={i}>{engineText(e, errorText, l)}</p>
              ))}
            </CardContent>
          )}
        </Card>
      )}
      {dry && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("editor.testTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {dry.error && (
              <p className="text-destructive">{errorText(dry.error)}</p>
            )}
            {dry.results?.map((r) => (
              <div key={r.recordId} className="space-y-1">
                <p className="font-medium">
                  {testRecords.find((x) => x.id === r.recordId)?.label ??
                    r.recordId}
                </p>
                {/* Un chemin par branche d'exécution parallèle. */}
                {r.paths.map((path) => (
                  <div key={path.id} className="space-y-1">
                    {r.paths.length > 1 && (
                      <p className="font-medium">
                        {t("editor.path", { id: path.id })}
                      </p>
                    )}
                    {path.steps.map((p, i) => (
                      <p key={`${p.stepId}-${i}`}>
                        {stepLabel(p.stepId)}{" "}
                        {showValue(p.branch) &&
                          `→ ${branchName(
                            def.steps.find((x) => x.id === p.stepId),
                            String(p.branch),
                            l.branch,
                          )}`}{" "}
                        :{" "}
                        {p.reasonItem
                          ? engineText(p.reasonItem, errorText, l)
                          : p.reason}
                      </p>
                    ))}
                    {path.error && (
                      <p className="text-destructive">{path.error}</p>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
