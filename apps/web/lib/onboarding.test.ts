import assert from "node:assert/strict";
import { test } from "node:test";
import { onboardingSteps } from "./onboarding";

test("onboardingSteps: checked according to the workspace state", () => {
  const steps = onboardingSteps({
    databases: 1,
    workflows: 0,
    interfaces: 2,
    agentConnected: false,
  });
  assert.deepEqual(
    steps.map((s) => [s.key, s.done]),
    [
      ["database", true],
      ["workflow", false],
      ["interface", true],
      ["agent", false],
    ],
  );
});
