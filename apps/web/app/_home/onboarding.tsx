import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@getrunbase/ui/components/ui/button";
import { ConnectAgent } from "@/components/connect-agent";
import { CopyField } from "@/components/copy-button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import type { OnboardingStep } from "@/lib/onboarding";
import { dismissOnboarding } from "./actions";

const PROMPTS = ["crm", "slack", "csv"] as const;

// Guided start (home): connect the AI first, then a template, a change
// asked to the AI and the team. Each step is checked from real data.
export async function Onboarding({
  steps,
  agent,
  mcpUrl,
  isAdmin,
  showTemplates,
}: {
  steps: OnboardingStep[];
  agent: {
    connected: boolean;
    via: "oauth" | "key" | null;
    client: string | null;
  };
  mcpUrl: string;
  isAdmin: boolean;
  // The template gallery is on the page (anchor #templates).
  showTemplates: boolean;
}) {
  const t = await getTranslations("home.onboarding");
  const done = steps.filter((s) => s.done).length;
  const finished = done === steps.length;
  const prompts = (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">{t("connected.prompts")}</p>
      {PROMPTS.map((p) => (
        <CopyField key={p} value={t(`prompts.${p}`)} />
      ))}
    </div>
  );
  const body = (key: OnboardingStep["key"], stepDone: boolean) => {
    switch (key) {
      case "agent":
        if (!agent.connected) return <ConnectAgent mcpUrl={mcpUrl} />;
        return (
          <div className="flex flex-col gap-3">
            <div className="bg-secondary flex flex-col gap-0.5 rounded-md border px-3 py-2">
              <p className="text-sm font-medium">{t("connected.title")}</p>
              <p className="text-muted-foreground text-sm">
                {agent.client
                  ? t("connected.client", { client: agent.client })
                  : agent.via === "key"
                    ? t("connected.viaKey")
                    : null}
              </p>
            </div>
            {prompts}
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="self-start">
                  {t("connected.show")}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <ConnectAgent mcpUrl={mcpUrl} />
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      case "template":
        if (stepDone || !isAdmin || !showTemplates) return null;
        return (
          <Button asChild size="sm" variant="secondary" className="self-start">
            <Link href="#templates">{t("steps.template.cta")}</Link>
          </Button>
        );
      case "change":
        if (stepDone) return null;
        return <CopyField value={t("steps.change.example")} />;
      case "team":
        if (stepDone) return null;
        return (
          <Button asChild size="sm" variant="secondary" className="self-start">
            <Link href="/settings/members">{t("steps.team.cta")}</Link>
          </Button>
        );
    }
  };
  // Next step to do: the only one opened, so the page stays short.
  const next = steps.find((s) => !s.done)?.key;
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-base font-semibold">
            {finished ? t("doneTitle") : t("title")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {finished
              ? t("doneHint")
              : t("progress", { done, total: steps.length })}
          </p>
        </div>
        {finished && (
          <form action={dismissOnboarding}>
            <Button type="submit" size="sm" variant="ghost">
              {t("dismiss")}
            </Button>
          </form>
        )}
      </div>
      <Progress value={(done / steps.length) * 100} />
      <ol className="divide-y">
        {steps.map((s, i) => {
          const open =
            s.key === next || (s.key === "agent" && s.done && !finished);
          const description =
            s.key === "template" && !isAdmin
              ? t("steps.template.descriptionMember")
              : t(`steps.${s.key}.description`);
          return (
            <li key={s.key} className="flex gap-3 py-3">
              {s.done ? (
                <CheckCircle2 className="text-primary mt-0.5 size-5 shrink-0" />
              ) : (
                <Circle className="text-muted-foreground mt-0.5 size-5 shrink-0" />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                  <p
                    className={
                      s.done
                        ? "text-muted-foreground text-sm font-medium"
                        : "text-sm font-medium"
                    }
                  >
                    {i + 1}. {t(`steps.${s.key}.title`)}
                  </p>
                  {(!s.done || open) && (
                    <p className="text-muted-foreground text-sm">
                      {description}
                    </p>
                  )}
                </div>
                {open && body(s.key, s.done)}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
