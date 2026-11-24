import { cn } from "../../lib/utils";

// Board eillb: KPI (zZPNs) card, border outline, radius-lg, padding 16, gap 6.
export function Kpi({
  label,
  value,
  delta,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="kpi" className={cn("flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      {delta && <p className="text-xs text-tag-green-fg">{delta}</p>}
    </div>
  );
}
