import { useTranslations } from "next-intl";
import type { T } from "@/lib/i18n-types";

// Collapsible JSON block: a readable summary, details on click.
export function summarize(v: unknown, t: T<"common">): string {
  if (v === null || v === undefined) return t("json.empty");
  if (Array.isArray(v)) return t("json.items", { count: v.length });
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (!keys.length) return t("json.empty");
    const shown = keys.slice(0, 4).join(", ");
    return keys.length > 4
      ? t("json.more", { shown, count: keys.length })
      : shown;
  }
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export function JsonView({
  label,
  value,
  open,
}: {
  label: string;
  value: unknown;
  open?: boolean;
}) {
  const t = useTranslations("common");
  return (
    <details open={open} className="group rounded-md border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground min-w-0 truncate">
          {summarize(value, t)}
        </span>
        <span className="text-muted-foreground ml-auto text-xs group-open:hidden">
          {t("show")}
        </span>
        <span className="text-muted-foreground ml-auto hidden text-xs group-open:inline">
          {t("hide")}
        </span>
      </summary>
      <pre className="bg-muted max-h-80 overflow-auto rounded-b-md p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
