// Member role labels, understandable without jargon: keys of the
// `common` namespace (`t(ROLE_LABELS[role])` with useTranslations("common")).
export const ROLE_LABELS = {
  owner: "roles.owner",
  admin: "roles.admin",
  member: "roles.member",
  viewer: "roles.viewer",
  end_user: "roles.end_user",
} as const;

export const ROLE_HINTS = {
  admin: "roleHints.admin",
  member: "roleHints.member",
  viewer: "roleHints.viewer",
  end_user: "roleHints.end_user",
} as const;
