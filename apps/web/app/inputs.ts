// Input schemas of the root server actions (app/actions.ts).
import { z } from "zod";
import { ASSIGNABLE_ROLES } from "@getrunbase/core/members";
import { id, list, trimmed, uuid } from "@/lib/action-input";

// Unknown or missing role falls back to "member".
const role = z
  .string()
  .optional()
  .transform(
    (r) => ASSIGNABLE_ROLES.find((x) => x === r) ?? ("member" as const),
  );
// Empty field = undefined (default value), otherwise a non-negative number.
const optNumber = trimmed
  .optional()
  .transform((v) => (v ? Number(v) : undefined))
  .pipe(z.number().nonnegative().optional());

export const idInput = z.object({ id });
export const nameInput = z.object({ name: trimmed.max(200).default("") });
export const renameInput = z.object({ id, name: trimmed.max(200).default("") });
// Workspace access from the picker: "all" switch on = null (all
// workspaces), otherwise the checked workspaces.
const access = {
  all: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "on"),
  workspaceIds: list.pipe(z.array(uuid)),
};
const toAccess = ({ all, workspaceIds }: { all: boolean; workspaceIds: string[] }) =>
  all ? null : workspaceIds;
export const inviteInput = z
  .object({
    email: z.union([z.literal(""), z.email()]).default(""),
    role,
    ...access,
  })
  .transform(({ all, workspaceIds, ...v }) => ({
    ...v,
    workspaceIds: toAccess({ all, workspaceIds }),
  }));
export const workspacesInput = z
  .object({ id, ...access })
  .transform(({ all, workspaceIds, id }) => ({
    id,
    workspaceIds: toAccess({ all, workspaceIds }),
  }));
export const roleInput = z.object({ id, role });
export const limitsInput = z.object({
  records: optNumber,
  runsPerMinute: optNumber,
  apiPerMinute: optNumber,
  concurrency: optNumber,
});
export const answerInput = z.object({
  organizationId: id,
  accept: z
    .string()
    .optional()
    .transform((v) => v === "1"),
});
export const budgetInput = z.object({
  budget: trimmed
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .pipe(z.number().nonnegative().nullable()),
});
