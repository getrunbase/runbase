import { test } from "node:test";
import assert from "node:assert/strict";
import { builtins, dateIn } from "./templates";

test("today renders in the given time zone", () => {
  const at = new Date("2026-03-01T23:30:00Z");
  assert.equal(builtins({ at }).today, "2026-03-01");
  assert.equal(builtins({ at, timeZone: "Europe/Paris" }).today, "2026-03-02");
  assert.equal(
    builtins({ at, timeZone: "America/New_York" }).today,
    "2026-03-01",
  );
  assert.equal(
    builtins({ at, timeZone: "Europe/Paris" }).now,
    at.toISOString(),
  );
});

test("unknown time zone falls back to UTC", () => {
  assert.equal(
    dateIn(new Date("2026-03-01T23:30:00Z"), "Nope/Zone"),
    "2026-03-01",
  );
});
