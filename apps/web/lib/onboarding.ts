// Home "in 10 minutes" checklist: each step is checked from
// the real workspace state. Labels: `home.onboarding.steps.<key>.*`.
export type OnboardingState = {
  databases: number;
  workflows: number;
  interfaces: number;
  agentConnected: boolean;
};

export function onboardingSteps(s: OnboardingState) {
  return [
    { key: "database", href: "/databases", done: s.databases > 0 },
    { key: "workflow", href: "/workflows", done: s.workflows > 0 },
    { key: "interface", href: "/interfaces", done: s.interfaces > 0 },
    { key: "agent", href: "/settings/api-keys", done: s.agentConnected },
  ] as const;
}
