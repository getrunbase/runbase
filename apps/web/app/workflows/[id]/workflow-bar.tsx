// Workflow edit bar (VnvTO board "Editor bar"): title,
// status, version, Editor / Runs / Versions tabs, actions.
// No "use client": rendered on the server (tabs) as in the editor.
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@getrunbase/ui/components/ui/tabs";
import { makeLabels } from "../labels";

export type WorkflowTab = "editor" | "runs" | "versions";
export const WORKFLOW_TABS: WorkflowTab[] = ["editor", "runs", "versions"];

// Status badge colour (board: Active green, Paused orange, Draft yellow).
export const workflowStatusVariant = (s: string) =>
  s === "active" ? "green" : s === "paused" ? "orange" : "yellow";

export function WorkflowBar({
  id,
  tab,
  title,
  status,
  version,
  updatedAt,
  children,
}: {
  id: string;
  tab: WorkflowTab;
  // Text, or an editable field in the Editor tab.
  title: React.ReactNode;
  status: string;
  version: number;
  updatedAt: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("workflows");
  const format = useFormatter();
  const now = useNow();
  const l = makeLabels(t);
  return (
    <div className="flex min-h-13.5 flex-wrap items-center gap-3 border-b px-5 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {title}
        <Badge variant={workflowStatusVariant(status)}>
          {l.status(status)}
        </Badge>
        <span className="text-subtle-foreground truncate text-xs">
          {t("bar.meta", {
            version,
            when: format.relativeTime(new Date(updatedAt), now),
          })}
        </span>
      </div>
      <Tabs value={tab}>
        <TabsList>
          {WORKFLOW_TABS.map((k) => (
            <TabsTrigger key={k} value={k} asChild>
              <Link
                href={
                  k === "editor"
                    ? `/workflows/${id}`
                    : `/workflows/${id}?tab=${k}`
                }
              >
                {t(`bar.tabs.${k}`)}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}
