// Home guided start: each step is checked from the real workspace state.
// Labels: `home.onboarding.steps.<key>.*`.
export type OnboardingState = {
  // An AI agent reaches the workspace (OAuth MCP grant or a recently used key).
  agentConnected: boolean;
  databases: number;
  workflows: number;
  pages: number;
  // A workflow or a page was edited after it was created.
  changed: boolean;
  // Members, pending invitations included.
  members: number;
  // Owner or admin: the only roles that install templates and invite.
  isAdmin: boolean;
};

export type OnboardingKey = "agent" | "template" | "change" | "team";
export type OnboardingStep = { key: OnboardingKey; done: boolean };

// Edits within this delay of the creation are part of the creation itself
// (a template import or a first save writes the row twice).
export const CHANGE_GRACE_MS = 60_000;

type Dated = { createdAt: Date; updatedAt: Date };

export const wasChanged = (items: Dated[]) =>
  items.some(
    (i) => i.updatedAt.getTime() - i.createdAt.getTime() > CHANGE_GRACE_MS,
  );

// The workspace holds something built: the dashboard comes first.
export const hasContent = (s: OnboardingState) =>
  s.databases + s.workflows + s.pages > 0;

export function onboardingSteps(s: OnboardingState): OnboardingStep[] {
  const steps: OnboardingStep[] = [
    { key: "agent", done: s.agentConnected },
    { key: "template", done: hasContent(s) },
    { key: "change", done: s.changed },
  ];
  if (s.isAdmin) steps.push({ key: "team", done: s.members > 1 });
  return steps;
}
