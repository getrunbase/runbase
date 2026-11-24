import assert from "node:assert/strict";
import { test } from "node:test";
import { makeLabels, statusVariant } from "./labels";
import { testT } from "./test-t";

test("run statuses are understandable", () => {
  const l = makeLabels(testT());
  assert.equal(l.status("failed"), "Échoué");
  assert.match(l.statusHint("failed"), /relancer/);
  assert.equal(makeLabels(testT("en")).status("failed"), "Failed");
  assert.equal(l.trigger("trigger.webhook"), "Webhook reçu");
  assert.equal(l.branch("inconnu"), "inconnu");
  assert.equal(statusVariant("failed"), "destructive");
  assert.equal(statusVariant("running"), "secondary");
});
