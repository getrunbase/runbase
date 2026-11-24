import type { Field } from "@getrunbase/core/objects";
import { slugify as slugifyText } from "@getrunbase/core/slug";

// Field edit row: options entered as text (comma-separated).
export type FieldRow = {
  key: string;
  label: string;
  type: Field["type"];
  options: string;
  object?: string;
  // Record title field.
  title?: boolean;
  // Type-specific settings and validation rules (formula, followed
  // relation, currency, pattern, bounds, default value…), kept as is.
  config?: Record<string, unknown>;
};

export const slugify = (s: string) => slugifyText(s, { startWithLetter: true });

export const toRow = (f: Field): FieldRow => {
  const { key, label, type, title, ...rest } = f;
  const { options, object, ...config } = rest as {
    options?: string[];
    object?: string;
  };
  return {
    key,
    label,
    type,
    options: options?.join(", ") ?? "",
    ...(object !== undefined && { object }),
    ...(title && { title: true }),
    ...(Object.keys(config).length && { config }),
  };
};

// Renaming keeps the key (records stay readable); a new field
// takes the key derived from its label.
export const toField = (r: FieldRow): Field => {
  const { options, object, title, config, ...f } = r;
  // Empty settings ("" or NaN entered in the form): removed.
  const extra = Object.fromEntries(
    Object.entries(config ?? {}).filter(
      ([, v]) => v !== "" && v !== undefined && !Number.isNaN(v),
    ),
  );
  const field = {
    ...extra,
    ...f,
    ...(title && { title: true }),
    key: r.key || slugify(r.label),
    ...((r.type === "ref" || r.type === "refs") && { object }),
  };
  return (
    r.type === "select" || r.type === "multi_select"
      ? {
          ...field,
          options: options
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : field
  ) as Field;
};
