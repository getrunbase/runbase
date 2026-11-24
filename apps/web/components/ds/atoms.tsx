import { isValidElement } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import { type Tone, toneBg, toneFg } from "./tone";

// Counter (aMrdh board "Count"): 11/600 dot on an accent background.
export function Count({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-accent text-muted-foreground inline-flex rounded-full px-1.5 py-px text-tiny font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

// Pill (KwyjQ board): p 3/10, full radius, 12/600.
export function Pill({
  tone = "blue",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-foreground inline-flex rounded-full px-2.5 py-0.75 text-xs font-semibold",
        toneBg[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const tileSize = {
  // Nav tile (18px, 11px icon), node tile (20px, 12px icon), panel tile (22px), large (44px, 20px icon).
  nav: "size-4.5 rounded-tile [&_svg]:size-2.75",
  node: "size-5 rounded-tile [&_svg]:size-3",
  // Step panel header (VnvTO board: 22px, 13px icon).
  panel: "size-5.5 rounded-tile [&_svg]:size-3.25",
  lg: "size-11 rounded-lg [&_svg]:size-5",
};

// Pastel icon tile (boards N4zA5, Fj8lH, KwyjQ).
export function IconTile({
  icon: Icon,
  tone = "neutral",
  size = "nav",
  className,
}: {
  // Lucide component or an already rendered element (e.g. dynamic icon).
  icon: LucideIcon | React.ReactElement;
  tone?: Tone;
  size?: keyof typeof tileSize;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        tileSize[size],
        toneBg[tone],
        toneFg[tone],
        className,
      )}
    >
      {isValidElement(Icon) ? Icon : <Icon />}
    </span>
  );
}

// KPI card (aMrdh board "KPI"): p 16, gap 6, radius 10, value 28/600.
export function Kpi({
  label,
  value,
  delta,
  deltaTone = "green",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaTone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-background flex flex-col gap-1.5 rounded-lg border p-4",
        className,
      )}
    >
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {delta && (
        <span className={cn("text-xs", toneFg[deltaTone])}>{delta}</span>
      )}
    </div>
  );
}
