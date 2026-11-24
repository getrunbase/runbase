import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

// Empty state (aMrdh board "Empty state"): dashed border, 24px icon,
// title 14/600, text 13 muted, optional action.
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center",
        className,
      )}
    >
      <Icon className="text-muted-foreground size-6" />
      <p className="text-base font-semibold">{title}</p>
      {description && (
        <p className="text-muted-foreground w-full text-sm">{description}</p>
      )}
      {children}
    </div>
  );
}
