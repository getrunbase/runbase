import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

// Board eillb: Empty state (IOotB) dashed border, radius-lg,
// padding 48, gap 12; icon 24 subtle; title 14/600; text 13 muted.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-12 text-center", className)}
    >
      {Icon && <Icon aria-hidden className="size-6 text-subtle-foreground" />}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}
