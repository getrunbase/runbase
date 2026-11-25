import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { apiKeysService } from "@getrunbase/core/api-keys";
import { databasesService } from "@getrunbase/core/databases";
import { errorsService } from "@getrunbase/core/errors";
import { pagesService } from "@getrunbase/core/pages";
import { runsService } from "@getrunbase/core/runs";
import { workflowsService } from "@getrunbase/core/workflows";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  CircleCheck,
  CirclePause,
  CircleX,
  LoaderCircle,
  Plus,
  X,
  type LucideIcon,
} from "lucide-react";
import { ConnectAgent } from "@/components/connect-agent";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Count, Kpi } from "@/components/ds/atoms";
import { type Tone, toneFg } from "@/components/ds/tone";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { onboardingSteps } from "@/lib/onboarding";
import { getTenant, getSession } from "@/lib/tenant";
import { appUrl } from "@getrunbase/core/env";
import { decideRun } from "./approvals/actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("home");

type RunStatus =
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "paused_budget"
  | "paused"
  | "canceled";

// Dot and icon for a run status (JhKCs board "Recent activity").
const STATUS: Record<RunStatus, { tone: Tone; icon: LucideIcon }> = {
  succeeded: { tone: "green", icon: CircleCheck },
  failed: { tone: "red", icon: CircleX },
  waiting: { tone: "orange", icon: CirclePause },
  paused: { tone: "orange", icon: CirclePause },
  paused_budget: { tone: "orange", icon: CirclePause },
  running: { tone: "blue", icon: LoaderCircle },
  canceled: { tone: "neutral", icon: Circle },
};

const DAY = 24 * 3600 * 1000;

// Home (JhKCs board): greeting, KPIs, recent activity, approvals.
export default async function Home() {
  // Visitor without a session: sign-in wall.
  if (!(await getSession())) redirect("/login");
  const { session, ctx, role } = await getTenant();
  const t = await getTranslations("home");
  const format = await getFormatter();
  const isAdmin = role === "owner" || role === "admin";
  const now = new Date();
  const since = new Date(now.getTime() - DAY);
  const before = new Date(now.getTime() - 2 * DAY);
  const [dbs, workflows, pages, keys, recent, waiting, open, day, prev] =
    await Promise.all([
      databasesService.list(ctx),
      workflowsService.list(ctx),
      pagesService.list(ctx),
      isAdmin ? apiKeysService.list(ctx) : Promise.resolve([]),
      runsService.list(ctx, { limit: 6 }),
      runsService.list(ctx, { status: "waiting", limit: 3 }),
      errorsService.openCount(ctx),
      runsService.statusCounts(ctx, since, now),
      runsService.statusCounts(ctx, before, since),
    ]);
  const waitingCount = (await runsService.waiting(ctx)).length;
  const total = (c: typeof day) =>
    Object.values(c).reduce((a, n) => a + (n ?? 0), 0);
  const rate = (c: typeof day) => {
    const ended = (c.succeeded ?? 0) + (c.failed ?? 0);
    return ended ? (c.succeeded ?? 0) / ended : null;
  };
  const runs = total(day);
  const prevRuns = total(prev);
  const success = rate(day);
  const prevSuccess = rate(prev);
  const when = (d: Date) => {
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (sameDay(d, now)) return format.dateTime(d, { timeStyle: "short" });
    if (sameDay(d, new Date(now.getTime() - DAY)))
      return t("activity.yesterday");
    return format.dateTime(d, { day: "numeric", month: "short" });
  };
  const name = (session.user.name || session.user.email).split(/[\s@]/)[0]!;
  const steps = onboardingSteps({
    databases: dbs.length,
    workflows: workflows.length,
    interfaces: pages.length,
    agentConnected: keys.some((k) => !k.revokedAt && k.lastUsedAt),
  });
  const done = steps.filter((s) => s.done).length;
  const mcpUrl = `${appUrl()}/api/mcp`;
  return (
    <main className="flex flex-1 flex-col gap-6 px-12 py-8">
      <PageHeader
        title={t("greeting", { name })}
        description={t("subtitle", {
          date: format.dateTime(now, {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
          count: waitingCount,
        })}
      >
        <Button asChild>
          <Link href="/workflows">
            <Plus />
            {t("newWorkflow")}
          </Link>
        </Button>
      </PageHeader>
      {done < steps.length && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">{t("onboarding.title")}</h2>
            <p className="text-muted-foreground text-sm">
              {t("onboarding.progress", { done, total: steps.length })}
            </p>
            <Progress value={(done / steps.length) * 100} className="mt-2" />
          </div>
          <Accordion type="single" collapsible defaultValue="ai">
            <AccordionItem value="ai">
              <AccordionTrigger>
                {t("onboarding.connect.withAi")}
              </AccordionTrigger>
              <AccordionContent>
                <ConnectAgent mcpUrl={mcpUrl} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="hand">
              <AccordionTrigger>
                {t("onboarding.connect.byHand")}
              </AccordionTrigger>
              <AccordionContent>
                <ol className="divide-y">
                  {steps.map((s) => (
                    <li
                      key={s.key}
                      className="flex flex-wrap items-center gap-3 py-3"
                    >
                      {s.done ? (
                        <CheckCircle2 className="text-primary size-5 shrink-0" />
                      ) : (
                        <Circle className="text-muted-foreground size-5 shrink-0" />
                      )}
                      <div className="min-w-48 flex-1">
                        <p
                          className={
                            s.done
                              ? "text-muted-foreground text-sm line-through"
                              : "text-sm font-medium"
                          }
                        >
                          {t(`onboarding.steps.${s.key}.title`)}
                        </p>
                        <p className="text-muted-foreground text-sm">
                          {t(`onboarding.steps.${s.key}.description`)}
                        </p>
                      </div>
                      {!s.done && (s.key !== "agent" || isAdmin) && (
                        <Button asChild size="sm" variant="secondary">
                          <Link href={s.href}>
                            {t(`onboarding.steps.${s.key}.cta`)}
                          </Link>
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
      )}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          label={t("kpi.runs")}
          value={format.number(runs)}
          delta={
            prevRuns
              ? t("kpi.runsDelta", { delta: (runs - prevRuns) / prevRuns })
              : undefined
          }
          deltaTone={runs >= prevRuns ? "green" : "red"}
        />
        <Kpi
          label={t("kpi.success")}
          value={
            success === null ? "—" : t("kpi.successValue", { rate: success })
          }
          delta={
            success === null
              ? t("kpi.noData")
              : prevSuccess !== null
                ? t("kpi.successDelta", {
                    delta: (success - prevSuccess) * 100,
                  })
                : undefined
          }
          deltaTone={
            success === null
              ? "neutral"
              : prevSuccess !== null && success < prevSuccess
                ? "red"
                : "green"
          }
        />
        <Kpi
          label={t("kpi.errors")}
          value={format.number(open)}
          delta={open ? t("kpi.errorsHint") : t("kpi.noErrors")}
          deltaTone={open ? "red" : "neutral"}
        />
        <Kpi
          label={t("kpi.waiting")}
          value={format.number(waitingCount)}
          delta={t("kpi.waitingHint", { count: waitingCount })}
          deltaTone="orange"
        />
      </div>
      <div className="flex flex-col gap-8 lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t("activity.title")}</h2>
            <Button asChild variant="ghost">
              <Link href="/runs">
                <ArrowRight />
                {t("activity.all")}
              </Link>
            </Button>
          </div>
          {recent.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("activity.empty")}
            </p>
          ) : (
            <ul className="flex flex-col">
              {recent.items.map((r) => {
                const st = STATUS[r.status as RunStatus];
                const Icon = st.icon;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/runs/${r.id}`}
                      className="hover:bg-secondary flex items-center gap-3 border-b py-3"
                    >
                      <Icon className={`size-4 shrink-0 ${toneFg[st.tone]}`} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">
                          {r.workflowName}
                        </span>
                        <span className="text-muted-foreground truncate text-xs">
                          {r.status === "failed" && r.error
                            ? r.error
                            : t("activity.started", {
                                date: format.relativeTime(r.createdAt, now),
                              })}
                        </span>
                      </span>
                      <Badge variant={st.tone}>
                        {t(`activity.status.${r.status as RunStatus}`)}
                      </Badge>
                      <span className="text-subtle-foreground font-mono text-xs">
                        {when(r.createdAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="flex w-full flex-col gap-3 lg:w-100">
          <div className="flex h-8 items-center gap-2">
            <h2 className="text-lg font-semibold">{t("approvals.title")}</h2>
            <Count>{waitingCount}</Count>
          </div>
          {waiting.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("approvals.empty")}
            </p>
          ) : (
            waiting.items.map((r) => (
              <form
                key={r.id}
                action={decideRun}
                className="flex flex-col gap-2 rounded-lg border p-4"
              >
                <input type="hidden" name="id" value={r.id} />
                <span className="text-muted-foreground text-xs">
                  {r.workflowName}
                </span>
                <Link href={`/runs/${r.id}`} className="text-sm font-semibold">
                  {t("approvals.step", { step: r.currentStep ?? "" })}
                </Link>
                <span className="text-muted-foreground text-sm">
                  {t("approvals.started", {
                    id: r.id.slice(0, 8),
                    date: format.relativeTime(r.createdAt, now),
                  })}
                </span>
                <div className="flex gap-2 pt-1">
                  <Button type="submit" name="decision" value="approve">
                    <Check />
                    {t("approvals.approve")}
                  </Button>
                  <Button
                    type="submit"
                    name="decision"
                    value="reject"
                    variant="secondary"
                  >
                    <X />
                    {t("approvals.reject")}
                  </Button>
                </div>
              </form>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
