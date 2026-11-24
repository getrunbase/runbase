import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

// Board eillb: Input label, text-sm 13 / 500 foreground.
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root data-slot="label" className={cn("text-sm font-medium text-foreground select-none", className)} {...props} />;
}

export { Label };
