import type { T } from "@/lib/i18n-types";

// Human labels of the audit log: `record.update` -> "Record updated".
// Messages: `home.audit.*`. Unknown action: raw label, never hidden.
// `feminine` drives French agreement (ICU select), ignored in English.
const RESOURCES = {
  record: true,
  object: false,
  database: true,
  workflow: false,
  run: true,
  function: true,
  page: true,
  component: false,
  query: true,
  view: true,
  webhook: false,
  secret: false,
  api_key: true,
  member: false,
  workspace: false,
  file: false,
} as const;
type Resource = keyof typeof RESOURCES;

// Action verb -> message key (synonyms grouped).
const VERBS = {
  create: "create",
  created: "create",
  save: "save",
  update: "update",
  updated: "update",
  rename: "rename",
  delete: "delete",
  deleted: "delete",
  remove: "delete",
  restore: "restore",
  merge: "merge",
  purge: "purge",
  migrate: "migrate",
  publish: "publish",
  pause: "pause",
  resume: "resume",
  cancel: "cancel",
  replay: "replay",
  retry_from: "retry_from",
  revoke: "revoke",
  set: "save",
  invite: "invite",
  upload: "upload",
  index: "index",
  clear_sample: "clear_sample",
} as const;

const SPECIAL = {
  "member.role": "memberRole",
  "workspace.settings": "workspaceSettings",
  "workspace.purge_test": "workspacePurgeTest",
} as const;

const has = <O extends object>(
  o: O,
  k: string,
): k is Extract<keyof O, string> => Object.hasOwn(o, k);

export function auditLabel(action: string, t: T<"home">): string {
  if (has(SPECIAL, action)) return t(`audit.special.${SPECIAL[action]}`);
  const [resource = "", verb = ""] = action.split(".");
  const r = has(RESOURCES, resource)
    ? resource
    : (resource.replace(/s$/, "") as Resource);
  if (!has(RESOURCES, r) || !has(VERBS, verb)) return action;
  return t("audit.label", {
    resource: t(`audit.resources.${r}`),
    verb: t(`audit.verbs.${VERBS[verb]}`, { feminine: String(RESOURCES[r]) }),
  });
}
