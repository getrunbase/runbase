// Readable summary of a field migration preview (objects.migrate dryRun).
export type MigrationReport = {
  records: number;
  touched: number;
  invalid: number;
  samples: { id: string; value: unknown; error: string }[];
};

// Translator for the `objects.migrate.summary` namespace (next-intl).
export type SummaryT = (
  key: "empty" | "base" | "invalid",
  values?: Record<string, number>,
) => string;

export function migrationSummary(r: MigrationReport, t: SummaryT) {
  if (!r.records) return t("empty");
  const base = t("base", { records: r.records, touched: r.touched });
  return r.invalid ? `${base} ${t("invalid", { count: r.invalid })}` : base;
}
