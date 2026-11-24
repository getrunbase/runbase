import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "../../lib/utils";

// Board eillb: Badge (fJ7rN) tag-<color>-bg / -fg, radius-sm 4,
// padding 2/6, text-xs 12 / 500. Color per variant.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        // shadcn variants not on the board, kept for existing screens.
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive: "bg-destructive text-primary-foreground [a&]:hover:bg-destructive/90",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-link underline-offset-4 [a&]:hover:underline",
        neutral: "bg-accent text-muted-foreground",
        blue: "bg-tag-blue-bg text-tag-blue-fg",
        green: "bg-tag-green-bg text-tag-green-fg",
        orange: "bg-tag-orange-bg text-tag-orange-fg",
        purple: "bg-tag-purple-bg text-tag-purple-fg",
        yellow: "bg-tag-yellow-bg text-tag-yellow-fg",
        red: "bg-tag-red-bg text-tag-red-fg",
        // "External" tag of Schema objects: background fill, border outline, 10 / 500 muted.
        outline: "bg-background px-1.5 py-px text-[10px] text-muted-foreground inset-ring inset-ring-border",
      },
    },
    defaultVariants: { variant: "blue" },
  },
);

function Badge({
  className,
  variant = "blue",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
