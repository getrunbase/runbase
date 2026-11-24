import { cn } from "../../lib/utils";

// Board eillb: Count (W9KT7) accent, radius-full, padding 1/6, 11 / 600 muted-foreground.
export function Count({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="count"
      className={cn("inline-flex items-center rounded-full bg-accent px-1.5 py-px text-[11px] leading-normal font-semibold text-muted-foreground", className)}
      {...props}
    />
  );
}
