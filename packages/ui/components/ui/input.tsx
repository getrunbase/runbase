import * as React from "react";
import { cn } from "../../lib/utils";

// Board eillb: Input (FMBKg) field background, input outline, radius-md,
// padding 8/12, text-sm 13, placeholder subtle-foreground.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 rounded-md bg-background px-3 py-2 text-sm text-foreground inset-ring inset-ring-input outline-none placeholder:text-subtle-foreground focus-visible:inset-ring-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:inset-ring-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
