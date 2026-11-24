import assert from "node:assert/strict";
import { test } from "node:test";
import { createTranslator } from "next-intl";
import fr from "../../messages/fr/objects.json";
import en from "../../messages/en/objects.json";
import { migrationSummary, type SummaryT } from "./migrate";

const tr = (locale: "fr" | "en", messages: object) =>
  createTranslator({
    locale,
    messages: { objects: messages },
    namespace: "objects.migrate.summary",
  } as never) as unknown as SummaryT;

test("migrationSummary: summary of the preview", () => {
  const t = tr("fr", fr);
  const r = { records: 0, touched: 0, invalid: 0, samples: [] };
  assert.match(migrationSummary(r, t), /sans risque/);
  assert.equal(
    migrationSummary({ ...r, records: 10, touched: 1 }, t),
    "10 fiches au total, 1 fiche sera modifiée.",
  );
  assert.equal(
    migrationSummary({ ...r, records: 3, touched: 3, invalid: 2 }, t),
    "3 fiches au total, 3 fiches seront modifiées. 2 valeurs ne peuvent pas être converties.",
  );
  assert.equal(
    migrationSummary(
      { ...r, records: 1, touched: 1, invalid: 1 },
      tr("en", en),
    ),
    "1 record in total, 1 record will change. 1 value can't be converted.",
  );
});
