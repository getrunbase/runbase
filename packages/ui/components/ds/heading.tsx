import { cn } from "../../lib/utils";

/** Small label above a title (mono, subtle-foreground). */
export function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("font-mono text-xs text-subtle-foreground uppercase", className)} {...props} />;
}

/** Site section title (text-h1 44, bold) + description text-lead 18 muted, gap 14. */
export function SectionHeading({
  title,
  description,
  eyebrow,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="flex flex-col gap-3.5">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className="text-h2 font-bold md:text-h1">{title}</h2>
        {description && <p className="max-w-[620px] text-lead text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Page header (oKAXv): title text-2xl 28 / 700, description text-base 14 muted, gap 4; actions gap 8. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end gap-4", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {description && <p className="text-base text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
