"use client";

import { useActionState } from "react";
import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@runbase/ui/components/ui/button";
import { Label } from "@runbase/ui/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useErrorText } from "@/lib/error-text";
import { testFunction, type TestResult } from "./actions";

// Test button: isolated run, output and logs.
export function TestPanel({
  name,
  version,
}: {
  name: string;
  version: number;
}) {
  const t = useTranslations("functions.test");
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<TestResult | null, FormData>(
    testFunction,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="version" value={version} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="input" className="text-base font-semibold">
          {t("input")}
        </Label>
        <Textarea
          id="input"
          name="input"
          className="bg-secondary font-mono text-xs"
          defaultValue="{}"
        />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        <Play />
        {pending ? t("running") : t("run")}
      </Button>
      {state?.error && (
        <pre className="text-destructive text-sm whitespace-pre-wrap">
          {errorText(state.error)}
        </pre>
      )}
      {state && !state.error && (
        <>
          <Label className="text-base font-semibold">{t("output")}</Label>
          <pre className="bg-secondary rounded-md px-3 py-2.5 font-mono text-xs whitespace-pre-wrap">
            {JSON.stringify(state.output, null, 2)}
          </pre>
          <Label className="text-base font-semibold">{t("logs")}</Label>
          <pre className="bg-secondary rounded-md px-3 py-2.5 font-mono text-xs whitespace-pre-wrap">
            {state.logs || t("noLogs")}
          </pre>
        </>
      )}
    </form>
  );
}
