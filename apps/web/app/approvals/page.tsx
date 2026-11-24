import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { runsService } from "@runbase/core/runs";
import { Button } from "@runbase/ui/components/ui/button";
import { Badge } from "@runbase/ui/components/ui/badge";
import { ArrowUpRight, Check, CircleCheckBig, History, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Count } from "@/components/ds/atoms";
import { cn } from "cn";
import { getTenant } from "@/lib/tenant";
import { decideRun } from "./actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("approvals");

// Runs paused on human.approve. XOX2b board.
export default async function Approvals() {
  const { ctx } = await getTenant();
  const t = await getTranslations("runs.approvals");
  const format = await getFormatter();
  const { items: runs } = await runsService.list(ctx, {
    status: "waiting",
    limit: 200,
  });
  return (
    <main className="flex flex-1 flex-col gap-6 px-10 py-8">
      <PageHeader title={t("title")} description={t("description")}>
        <Button asChild variant="secondary">
          <Link href="/runs">
            <History />
            {t("history")}
          </Link>
        </Button>
      </PageHeader>
      <div className="flex gap-1">
        <span className="bg-accent text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium">
          {t("pending")}
          <Count>{runs.length}</Count>
        </span>
      </div>
      {runs.length === 0 ? (
        <EmptyState
          icon={CircleCheckBig}
          title={t("empty.title")}
          description={t("empty.description")}
        >
          <Button asChild variant="secondary">
            <Link href="/runs">{t("empty.cta")}</Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {runs.map((r, i) => (
            <form
              key={r.id}
              action={decideRun}
              className={cn(
                "bg-background flex flex-col gap-3 rounded-lg border p-4",
                i === 0 ? "border-foreground" : "border-border",
              )}
            >
              <input type="hidden" name="id" value={r.id} />
              <div className="flex items-center gap-3">
                <Badge variant="orange">{t("kind")}</Badge>
                <span className="text-foreground min-w-0 flex-1 truncate text-base font-semibold">
                  {r.workflowName}
                </span>
                <span className="text-subtle-foreground text-xs">
                  {format.relativeTime(r.createdAt)}
                </span>
              </div>
              <p className="text-muted-foreground text-sm">
                {t("item", {
                  workflow: r.workflowName,
                  id: r.id.slice(0, 8),
                  step: r.currentStep ?? "",
                })}
              </p>
              {r.currentStep && (
                <div className="bg-secondary flex rounded-md px-3 py-2">
                  <span className="text-muted-foreground flex-1 truncate font-mono text-xs">
                    {r.currentStep}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="decision" value="approve">
                  <Check />
                  {t("approve")}
                </Button>
                <Button
                  type="submit"
                  name="decision"
                  value="reject"
                  variant="secondary"
                >
                  <X />
                  {t("reject")}
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="text-muted-foreground"
                >
                  <Link href={`/runs/${r.id}`}>
                    <ArrowUpRight />
                    {t("details")}
                  </Link>
                </Button>
              </div>
            </form>
          ))}
        </div>
      )}
    </main>
  );
}
