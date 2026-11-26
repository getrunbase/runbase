import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSeeSettings,
  canSeeUsage,
  isOrgAdmin,
  settingsHome,
} from "./settings-access";

test("settings access: owner and admin see everything", () => {
  for (const r of ["owner", "admin"] as const) {
    assert.equal(isOrgAdmin(r), true);
    assert.equal(canSeeUsage(r), true);
    assert.equal(settingsHome(r), "/settings/general");
  }
});

test("settings access: member sees usage only", () => {
  assert.equal(isOrgAdmin("member"), false);
  assert.equal(canSeeUsage("member"), true);
  assert.equal(settingsHome("member"), "/settings/usage");
});

test("settings access: viewer and end user see no settings", () => {
  for (const r of ["viewer", "end_user", null] as const) {
    assert.equal(isOrgAdmin(r), false);
    assert.equal(canSeeSettings(r), false);
    assert.equal(settingsHome(r), null);
  }
});
