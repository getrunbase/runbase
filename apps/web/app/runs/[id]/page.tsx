import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { blocksService } from "@getrunbase/core/blocks";
import { runsService } from "@getrunbase/core/runs";
import { workflowsService } from "@getrunbase/core/workflows";
import { CircleCheck, CircleX, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { Kpi } from "@/components/ds/atoms";
import { toneBg, toneFg } from "@/components/ds/tone";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@getrunbase/ui/components/ui/button";
import { getErrorText } from "@/lib/error-text-server";
import { getTenant } from "@/lib/tenant";
import { decideRun } from "../../approvals/actions";
import { controlRun } from "./actions";
import type { Definition } from "../../workflows/graph";
import { RunGraph } from "./run-graph";
import { makeLabels } from "../../workflows/labels";
import { runTone } from "../status-tone";
import { ConfirmAction } from "@/components/confirm-action";
import { JsonView } from "@/components/json-view";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("run");

// Error of a run control action (controlRun), serialized in the URL.
// Only a well-formed item is shown, translated; anything else is generic.
async function controlErrorText(raw?: string) {
  if (!raw) return null;
  const t = await getTranslations("runs.detail.errors");
  try {
    const item = JSON.parse(raw) as unknown;
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as { code?: unknown }).code !== "string" ||
      typeof (item as { message?: unknown }).message !== "string"
    )
      return t("failed");
    if ((item as { code: string }).code === "runs.alreadyActive")
      return t("alreadyActive");
    return (await getErrorText())(item);
  } catch {
    return t("failed");
  }
}

// Run detail: highlighted path, input / output and cost per step.
export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erreur?: string }>;
}) {
  const { id } = await params;
  const { erreur } = await searchParams;
  const errorMessage = await controlErrorText(erreur);
  const { ctx } = await getTenant();
  const t = await getTranslations("runs.detail");
  const tA = await getTranslations("runs.approvals");
  const {
    branch: branchLabel,
    status: statusLabel,
    statusHint,
  } = makeLabels(await getTranslations("workflows"));
  const format = await getFormatter();
  const usd = (n: number) =>
    format.number(n, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 4,
    });
  const run = await runsService.get(ctx, id);
  if (!run) notFound();
  const [versions, blocks, workflow] = await Promise.all([
    workflowsService.versions(ctx, run.workflowId),
    blocksService.list(ctx),
    workflowsService.get(ctx, run.workflowId),
  ]);
  const definition = versions.find((v) => v.version === run.version)
    ?.definition as Definition | undefined;
  const cost = run.steps.reduce((t, s) => t + (s.cost ?? 0), 0);
  const finished = ["succeeded", "failed", "canceled"].includes(run.status);
  // Paths taken (parallel execution branches), in order of appearance.
  const paths = [...new Set(run.steps.map((s) => s.path))].map((id) => ({
    id,
    steps: run.steps.filter((s) => s.path === id),
  }));
  const totalMs = run.finishedAt
    ? run.finishedAt.getTime() - run.createdAt.getTime()
    : null;
  const tokens = run.steps.reduce((n, s) => {
    const k = s.tokens as { input?: number; output?: number } | null;
    return n + (k?.input ?? 0) + (k?.output ?? 0);
  }, 0);
  const seconds = (ms: number) =>
    format.number(ms / 1000, {
      style: "unit",
      unit: "second",
      maximumFractionDigits: 1,
    });
  return (
    <main className="flex flex-1 flex-col gap-4 px-12 py-6">
      {errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
      <PageHeader
        title={t("title", { id: run.id.slice(0, 8) })}
        description={t("description", {
          workflow: workflow?.name ?? "",
          version: run.version,
          date: format.dateTime(run.createdAt, {
            dateStyle: "medium",
            timeStyle: "medium",
          }),
        })}
      >
        {run.isTest && <Badge variant="neutral">{t("test")}</Badge>}
        {run.status === "waiting" && (
          <form action={decideRun} className="flex gap-2">
            <input type="hidden" name="id" value={run.id} />
            <Button
              type="submit"
              name="decision"
              value="reject"
              variant="destructive"
            >
              {tA("reject")}
            </Button>
            <Button type="submit" name="decision" value="approve">
              {tA("approve")}
            </Button>
          </form>
        )}
        {!finished && (
          <ConfirmAction
            action={controlRun}
            fields={{ id: run.id, action: "cancel" }}
            variant="outline"
            label={t("cancel.label")}
            title={t("cancel.title")}
            description={t("cancel.description")}
            confirmLabel={t("cancel.label")}
          />
        )}
        <form action={controlRun} className="flex gap-2">
          <input type="hidden" name="id" value={run.id} />
          {finished ? (
            <Button type="submit" name="action" value="replay">
              <RotateCcw />
              {t("replay")}
            </Button>
          ) : run.status === "paused" ? (
            <Button type="submit" name="action" value="resume">
              {t("resume")}
            </Button>
          ) : (
            <Button type="submit" name="action" value="pause" variant="outline">
              {t("pause")}
            </Button>
          )}
        </form>
      </PageHeader>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label={t("kpi.status")}
          value={
            <span className={toneFg[runTone(run.status)]}>
              {statusLabel(run.status)}
            </span>
          }
          delta={statusHint(run.status)}
          deltaTone="neutral"
        />
        <Kpi
          label={t("kpi.duration")}
          value={totalMs === null ? "—" : seconds(totalMs)}
          delta={t("kpi.stepsDone", { count: run.steps.length })}
          deltaTone="neutral"
        />
        <Kpi
          label={t("kpi.cost")}
          value={usd(cost)}
          delta={t("totalCost", { cost: usd(cost) })}
          deltaTone="neutral"
        />
        <Kpi
          label={t("kpi.tokens")}
          value={format.number(tokens)}
          delta={t("kpi.tokensHint")}
          deltaTone="neutral"
        />
      </div>
      {run.error && (
        <Alert variant="destructive">
          <AlertDescription>{run.error}</AlertDescription>
        </Alert>
      )}
      {paths.map((path) => (
        <section key={path.id} className="flex flex-col">
          {paths.length > 1 && (
            <h2 className="pb-2 text-sm font-semibold">
              {t("path", {
                id: path.id,
                steps: path.steps.map((s) => s.stepId).join(" → "),
              })}
            </h2>
          )}
          {path.steps.map((s, i) => {
            const failed = !!s.error;
            const tone = failed ? "red" : "green";
            const Icon = failed ? CircleX : CircleCheck;
            const logs =
              "logs" in s && s.logs.some((l) => l.logs)
                ? s.logs.map((l) => l.logs).join("\n")
                : null;
            return (
              <div key={s.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full [&_svg]:size-3.5",
                      toneBg[tone],
                      toneFg[tone],
                    )}
                  >
                    <Icon />
                  </span>
                  {i < path.steps.length - 1 && (
                    <span className="bg-border w-px flex-1" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1 pb-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1 text-sm font-semibold">
                      {t("step", { seq: s.seq, id: s.stepId })}
                    </span>
                    {s.branch && (
                      <Badge variant="neutral">{branchLabel(s.branch)}</Badge>
                    )}
                    {s.startedAt && (
                      <span className="text-subtle-foreground font-mono text-xs">
                        {format.dateTime(s.startedAt, { timeStyle: "medium" })}
                      </span>
                    )}
                    <span className="text-muted-foreground font-mono text-xs">
                      {seconds(s.durationMs ?? 0)}
                      {s.attempts > 1 &&
                        ` · ${t("attempts", { count: s.attempts })}`}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {usd(s.cost ?? 0)}
                    </span>
                    <Badge variant={tone}>
                      {statusLabel(failed ? "failed" : "succeeded")}
                    </Badge>
                    {finished && (
                      <form action={controlRun}>
                        <input type="hidden" name="id" value={run.id} />
                        <input type="hidden" name="step" value={s.stepId} />
                        <Button
                          type="submit"
                          name="action"
                          value="retry_from"
                          variant="ghost"
                          size="sm"
                        >
                          {t("retryFrom")}
                        </Button>
                      </form>
                    )}
                  </div>
                  <JsonView label={t("input")} value={s.input} />
                  <JsonView
                    label={t("output")}
                    value={s.output}
                    open={!!s.error}
                  />
                  {s.error && (
                    <p className="text-destructive text-sm">{s.error}</p>
                  )}
                  {logs && (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-medium">{t("logs")}</p>
                      <pre className="bg-secondary leading-node max-h-48 overflow-auto rounded-md border px-4 py-3 font-mono text-xs whitespace-pre-wrap">
                        {logs}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ))}
      {definition && (
        <div className="h-105 rounded-lg border">
          <RunGraph
            definition={definition}
            blocks={blocks}
            path={run.steps.map((s) => [s.stepId, s.branch])}
            current={run.currentStep}
          />
        </div>
      )}
    </main>
  );
}
