// Per-workspace cookie set once the finished guided start is hidden.
export const onboardingCookie = (workspaceId: string) =>
  `rb_onboarding_${workspaceId}`;
