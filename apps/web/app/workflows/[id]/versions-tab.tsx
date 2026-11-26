"use client";

// Workflow Versions tab (GMnKy board): history on the left,
// changes of the chosen version against the previous one on the right.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { GitBranch, RotateCcw, SquarePen } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import type { ActionError } from "@/lib/action-error";
import { useErrorText } from "@/lib/error-text";
import { restoreWorkflow } from "../actions";

export type VersionInfo = {
  version: number;
  createdAt: string;
  definition: unknown;
};

type Line = { kind: " " | "-" | "+"; text: string; n: number };

// Line-by-line diff (longest common subsequence).
export function diffLines(a: string[], b: string[]): Line[] {
  const m = a.length;
  const n = b.length;
  const L = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      L[i]![j] =
        a[i] === b[j]
          ? L[i + 1]![j + 1]! + 1
          : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      out.push({ kind: " ", text: b[j]!, n: j + 1 });
      i++;
      j++;
    } else if (j < n && (i >= m || L[i]![j + 1]! >= L[i + 1]![j]!)) {
      out.push({ kind: "+", text: b[j]!, n: j + 1 });
      j++;
    } else {
      out.push({ kind: "-", text: a[i]!, n: i + 1 });
      i++;
    }
  }
  return out;
}

// Keeps changed lines and 2 lines of context around them.
function hunk(lines: Line[]) {
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (l.kind !== " ") for (let k = i - 2; k <= i + 2; k++) keep.add(k);
  });
  return lines.filter((_, i) => keep.has(i));
}

const pretty = (d: unknown) => JSON.stringify(d ?? {}, null, 2).split("\n");

export function VersionsTab({
  id,
  current,
  versions,
}: {
  id: string;
  current: number;
  versions: VersionInfo[];
}) {
  const t = useTranslations("workflows.versions");
  const format = useFormatter();
  const now = useNow();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);
  const errorText = useErrorText();
  const rows = [...versions].reverse();
  const [selected, setSelected] = useState(current);
  const sel = versions.find((v) => v.version === selected);
  const prev = versions.filter((v) => v.version < selected).at(-1);
  const lines = useMemo(
    () =>
      sel
        ? diffLines(prev ? pretty(prev.definition) : [], pretty(sel.definition))
        : [],
    [sel, prev],
  );
  const added = lines.filter((l) => l.kind === "+").length;
  const removed = lines.filter((l) => l.kind === "-").length;
  const shown = hunk(lines);
  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex w-115 shrink-0 flex-col gap-4 overflow-y-auto border-r p-6">
        <div className="flex items-center">
          <h2 className="flex-1 text-base font-semibold">{t("title")}</h2>
          <span className="text-muted-foreground text-xs">
            {t("count", { count: versions.length })}
          </span>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {errorText(error)}
          </p>
        )}
        <div className="flex flex-col">
          {rows.map((v) => (
            <div
              key={v.version}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(v.version)}
              onKeyDown={(e) => e.key === "Enter" && setSelected(v.version)}
              className={cn(
                "flex cursor-pointer gap-3 rounded-md p-3",
                v.version === selected ? "bg-sidebar-accent" : "border-b",
              )}
            >
              <span className="w-6 font-mono text-sm font-medium">
                v{v.version}
              </span>
              <div className="flex flex-1 flex-col gap-1.5">
                <span className="text-sm">
                  {format.dateTime(new Date(v.createdAt), {
                    dateStyle: "long",
                    timeStyle: "short",
                  })}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-xs">
                    {format.relativeTime(new Date(v.createdAt), now)}
                  </span>
                  {v.version === current && (
                    <Badge variant="green">{t("live")}</Badge>
                  )}
                </div>
              </div>
              {v.version !== current && (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={(e) => {
                    e.stopPropagation();
                    start(async () => {
                      const r = await restoreWorkflow(id, v.version);
                      setError(r.error ?? null);
                      if (r.error) return;
                      router.push(`/workflows/${id}`);
                    });
                  }}
                >
                  <RotateCcw />
                  {t("restore")}
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <h2 className="text-base font-semibold">
              {prev
                ? t("changes", { from: prev.version, to: selected })
                : t("initial", { version: selected })}
            </h2>
            {sel && (
              <p className="text-muted-foreground text-sm">
                {t("createdAt", {
                  date: format.dateTime(new Date(sel.createdAt), {
                    dateStyle: "short",
                    timeStyle: "short",
                  }),
                })}
              </p>
            )}
          </div>
          <Badge variant="blue">
            +{added} −{removed}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <GitBranch className="text-muted-foreground size-3.5" />
          <span className="text-sm font-medium">{t("definition")}</span>
        </div>
        <div className="flex flex-col overflow-hidden rounded-md border py-2">
          {shown.length === 0 ? (
            <p className="text-muted-foreground px-4 py-0.75 text-xs">
              {t("noChanges")}
            </p>
          ) : (
            shown.map((l, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-3 px-4 py-0.75 font-mono text-xs",
                  l.kind === "-" && "bg-tag-red-bg text-tag-red-fg",
                  l.kind === "+" && "bg-tag-green-bg text-tag-green-fg",
                )}
              >
                <span className="text-subtle-foreground w-5 shrink-0 text-right">
                  {l.n}
                </span>
                <span
                  className={cn(
                    "w-2 shrink-0",
                    l.kind === " " && "text-subtle-foreground",
                  )}
                >
                  {l.kind}
                </span>
                <span className="whitespace-pre-wrap break-all">{l.text}</span>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild className="text-muted-foreground">
            <Link href={`/workflows/${id}`}>
              <SquarePen />
              {t("openEditor")}
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
