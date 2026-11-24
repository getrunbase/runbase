// Board tag colours (tokens.md "Tags"). Literal classes so
// Tailwind detects them.
export type Tone =
  "neutral" | "blue" | "green" | "orange" | "purple" | "yellow" | "red";

export const toneBg: Record<Tone, string> = {
  neutral: "bg-accent",
  blue: "bg-tag-blue-bg",
  green: "bg-tag-green-bg",
  orange: "bg-tag-orange-bg",
  purple: "bg-tag-purple-bg",
  yellow: "bg-tag-yellow-bg",
  red: "bg-tag-red-bg",
};

export const toneFg: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  blue: "text-tag-blue-fg",
  green: "text-tag-green-fg",
  orange: "text-tag-orange-fg",
  purple: "text-tag-purple-fg",
  yellow: "text-tag-yellow-fg",
  red: "text-tag-red-fg",
};
