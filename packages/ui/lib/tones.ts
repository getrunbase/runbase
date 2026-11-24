// Tag colors of the .pen (tag-<color>-bg / -fg), shared by Badge,
// Pill and IconTile.
export const toneBg = {
  blue: "bg-tag-blue-bg",
  green: "bg-tag-green-bg",
  orange: "bg-tag-orange-bg",
  purple: "bg-tag-purple-bg",
  yellow: "bg-tag-yellow-bg",
  red: "bg-tag-red-bg",
  lilac: "bg-tag-lilac-bg",
  neutral: "bg-surface-strong",
} as const;

export const toneFg = {
  blue: "text-tag-blue-fg",
  green: "text-tag-green-fg",
  orange: "text-tag-orange-fg",
  purple: "text-tag-purple-fg",
  yellow: "text-tag-yellow-fg",
  red: "text-tag-red-fg",
  lilac: "text-tag-purple-fg",
  neutral: "text-foreground",
} as const;

export type Tone = keyof typeof toneBg;
