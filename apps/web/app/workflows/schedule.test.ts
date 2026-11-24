import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, fromCron, toCron } from "./schedule";
import { testT } from "./test-t";

const t = testT();

test("schedule: cron round trip and readable sentence", () => {
  for (const cron of [
    "0 9 * * 1,2,3,4,5",
    "30 * * * *",
    "15 8 1 * *",
    "0 18 * * *",
  ])
    assert.equal(toCron(fromCron(cron)), cron);
  assert.equal(
    describe(fromCron("0 9 * * 1,2,3,4,5"), t),
    "Du lundi au vendredi à 9 h 00",
  );
  assert.equal(
    describe(fromCron("0 9 * * 1,4"), t),
    "Chaque lundi et jeudi à 9 h 00",
  );
  assert.equal(
    describe(fromCron("15 8 1 * *"), t),
    "Le 1er de chaque mois à 8 h 15",
  );
  assert.equal(describe(fromCron("0 18 * * *"), t), "Tous les jours à 18 h 00");
  assert.equal(
    describe(fromCron("0 9 * * 1,4"), testT("en")),
    "Every Monday and Thursday at 9:00",
  );
  assert.equal(
    describe(fromCron("15 8 2 * *"), testT("en")),
    "On the 2nd of every month at 8:15",
  );
  // Outside known shapes: kept as is.
  assert.deepEqual(fromCron("*/5 * * * *"), {
    freq: "custom",
    cron: "*/5 * * * *",
  });
});
