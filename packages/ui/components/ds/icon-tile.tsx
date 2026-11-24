import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { toneBg, type Tone } from "../../lib/tones";

// Board eillb: Icon tile (GWZWT) 44x44 radius-lg, icon 20 foreground;
// Flow node tile 20x20 radius 5, icon 12.
const sizes = {
  sm: "size-5 rounded-[5px] [&_svg]:size-3",
  lg: "size-11 rounded-lg [&_svg]:size-5",
} as const;

export function IconTile({
  icon: Icon,
  tone = "blue",
  size = "lg",
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      data-slot="icon-tile"
      className={cn("inline-flex shrink-0 items-center justify-center text-foreground", toneBg[tone], sizes[size], className)}
    >
      <Icon aria-hidden />
    </span>
  );
}
