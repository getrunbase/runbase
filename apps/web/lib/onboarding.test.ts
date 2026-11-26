import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHANGE_GRACE_MS,
  hasContent,
  onboardingSteps,
  wasChanged,
  type OnboardingState,
} from "./onboarding";

const empty: OnboardingState = {
  agentConnected: false,
  databases: 0,
  workflows: 0,
  pages: 0,
  changed: false,
  members: 1,
  isAdmin: true,
};

const done = (s: OnboardingState) =>
  onboardingSteps(s).map((x) => [x.key, x.done]);

test("onboardingSteps: new workspace, nothing done, AI connection first", () => {
  assert.deepEqual(done(empty), [
    ["agent", false],
    ["template", false],
    ["change", false],
    ["team", false],
  ]);
});

test("onboardingSteps: checked according to the workspace state", () => {
  assert.deepEqual(
    done({
      ...empty,
      agentConnected: true,
      pages: 1,
      changed: true,
      members: 2,
    }),
    [
      ["agent", true],
      ["template", true],
      ["change", true],
      ["team", true],
    ],
  );
  // Any built thing counts as a start (template or the AI's own build).
  for (const k of ["databases", "workflows", "pages"] as const)
    assert.equal(onboardingSteps({ ...empty, [k]: 1 })[1]!.done, true);
});

test("onboardingSteps: invite step only for owners and admins", () => {
  assert.deepEqual(
    onboardingSteps({ ...empty, isAdmin: false }).map((s) => s.key),
    ["agent", "template", "change"],
  );
});

test("hasContent: false only for an empty workspace", () => {
  assert.equal(hasContent(empty), false);
  assert.equal(hasContent({ ...empty, databases: 1 }), true);
  assert.equal(hasContent({ ...empty, agentConnected: true }), false);
});

test("wasChanged: edits right after creation do not count", () => {
  const at = new Date("2026-11-26T10:00:00Z");
  const later = (ms: number) => new Date(at.getTime() + ms);
  assert.equal(wasChanged([]), false);
  assert.equal(wasChanged([{ createdAt: at, updatedAt: at }]), false);
  assert.equal(
    wasChanged([{ createdAt: at, updatedAt: later(CHANGE_GRACE_MS) }]),
    false,
  );
  assert.equal(
    wasChanged([
      { createdAt: at, updatedAt: at },
      { createdAt: at, updatedAt: later(CHANGE_GRACE_MS + 1) },
    ]),
    true,
  );
});
