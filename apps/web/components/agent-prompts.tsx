"use client";

import { useState } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import type common from "@/messages/en/common.json";

type Group = Exclude<
  keyof (typeof common)["agentPrompts"],
  "title" | "copy" | "copied" | "copyLabel"
>;

// Example requests the user can copy and paste to their AI agent,
// shown on empty states. Either a message group (`agentPrompts.<group>`)
// or already translated `prompts`.
export function AgentPrompts({
  group,
  prompts: given,
  title,
}: {
  group?: Group;
  prompts?: string[];
  title?: string;
}) {
  const t = useTranslations("common.agentPrompts");
  const prompts =
    given ??
    (group
      ? (["p1", "p2", "p3"] as const)
          .filter((k) => t.has(`${group}.${k}` as `workflows.p1`))
          .map((k) => t(`${group}.${k}` as `workflows.p1`))
      : []);
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <div className="flex w-full max-w-xl flex-col gap-2 text-left">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Sparkles className="size-3.5" />
        {title ?? t("title")}
      </p>
      <ul className="flex flex-col gap-2">
        {prompts.map((p, i) => (
          <li
            key={p}
            className="bg-muted/50 flex items-center gap-3 rounded-md border px-3 py-2"
          >
            <span className="min-w-0 flex-1 text-sm">{p}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={t("copyLabel", { prompt: p })}
              onClick={async () => {
                await navigator.clipboard.writeText(p);
                setCopied(i);
                setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
              }}
            >
              {copied === i ? <Check /> : <Copy />}
              <span aria-live="polite">
                {copied === i ? t("copied") : t("copy")}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
