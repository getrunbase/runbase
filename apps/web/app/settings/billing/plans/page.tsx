import { billingService } from "@getrunbase/core/quotas";
import type { BillingPlan } from "@getrunbase/core/extensions";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@getrunbase/ui/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@getrunbase/ui/components/ui/tabs";
import { getTenant } from "@/lib/tenant";
import { planPrice, type Interval } from "@/lib/plan-price";
import { SettingsPage } from "../../settings-shell";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("plans");

const INTERVALS: Interval[] = ["month", "year"];

// Settings › Plan and usage › Plans: plan catalog provided by the billing
// extension. Owners and admins only; no extension or no plans: no page.
export default async function Plans() {
  const { ctx, role } = await getTenant();
  if (role !== "owner" && role !== "admin") notFound();
  const catalog = await billingService.plans(ctx);
  if (!catalog) notFound();
  const t = await getTranslations("settings.billing.plans");
  const locale = await getLocale();

  const card = (plan: BillingPlan, interval: Interval) => {
    const current = plan.id === catalog.current;
    const price = planPrice(plan, interval, locale);
    return (
      <Card key={plan.id} data-plan={plan.id} className={current ? "border-primary" : undefined}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>{plan.name}</CardTitle>
            {current && <Badge variant="secondary">{t("current")}</Badge>}
          </div>
          {plan.description && <CardDescription>{plan.description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-foreground text-2xl font-semibold tabular-nums">
              {price.amount}
              <span className="text-muted-foreground text-sm font-normal">
                {" "}
                {interval === "month" ? t("perMonth") : t("perYear")}
              </span>
            </p>
            {price.perMonth && (
              <p className="text-muted-foreground text-xs tabular-nums">
                {t("equivalent", { price: price.perMonth })}
              </p>
            )}
          </div>
          {plan.highlights.length > 0 && (
            <ul className="flex flex-col gap-2 text-sm">
              {plan.highlights.map((h) => (
                <li key={h} className="flex items-start gap-2">
                  <Check className="text-primary mt-0.5 size-3.5 shrink-0" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        {!current && plan.checkoutUrl && (
          <CardFooter>
            <Button className="w-full" asChild>
              <a href={plan.checkoutUrl[interval]}>{t("choose")}</a>
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  };

  return (
    <SettingsPage isAdmin>
      <div className="flex flex-col gap-1">
        <Link
          href="/settings/billing"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-3.5" />
          {t("back")}
        </Link>
        <h2 className="text-foreground text-base font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <Tabs defaultValue={catalog.interval ?? "month"} className="gap-4">
        <TabsList>
          {INTERVALS.map((i) => (
            <TabsTrigger key={i} value={i}>
              {t(i === "month" ? "monthly" : "yearly")}
            </TabsTrigger>
          ))}
        </TabsList>
        {INTERVALS.map((i) => (
          <TabsContent key={i} value={i}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {catalog.plans.map((p) => card(p, i))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </SettingsPage>
  );
}
