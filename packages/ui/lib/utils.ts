import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Design system text sizes (theme.css): without this, twMerge takes them
// for colors and removes e.g. text-primary-foreground.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "tiny", "md", "brand", "lead", "h3", "h2", "h1", "display"] }],
      leading: [{ leading: ["node"] }],
      tracking: [{ tracking: ["page", "brand"] }],
      rounded: [{ rounded: ["2xs", "tile"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
