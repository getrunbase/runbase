import { cn } from "../../lib/utils";
import { toneBg, type Tone } from "../../lib/tones";

// Board eillb: Pill (fx5LG) radius-full, padding 3/10, text-xs 600 foreground.
export function Pill({ tone = "blue", className, ...props }: React.ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      data-slot="pill"
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-xs font-semibold text-foreground", toneBg[tone], className)}
      {...props}
    />
  );
}
